import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import type { IncomingMessage } from 'http';
import type { Server, WebSocket } from 'ws';
import { Pool } from 'pg';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../db/db.module';
import { AuthService } from '../auth/auth.service';

@Injectable()
@WebSocketGateway({ path: '/chat/ws' })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly timers = new Map<WebSocket, NodeJS.Timeout>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool, private readonly auth: AuthService) {}

  async handleConnection(client: WebSocket, request: IncomingMessage) {
    const cookie = String(request.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('simha_session='))?.split('=').slice(1).join('=');
    const user = await this.auth.sessionUser(cookie);
    if (!user) { client.close(1008, 'Authentication required'); return; }
    client.send(JSON.stringify({ type: 'connected', channel: 'simha-intake', user_id: user.id }));
    const timer = setInterval(async () => {
      if (client.readyState !== 1) return;
      const { rows } = await this.pool.query(`SELECT id,status,updated_at FROM file_ingestion_jobs WHERE owner_user_id=$1 ORDER BY updated_at DESC LIMIT 10`, [user.id]);
      client.send(JSON.stringify({ type: 'ingestion.updated', jobs: rows }));
    }, 3000);
    this.timers.set(client, timer);
  }

  handleDisconnect(client: WebSocket) {
    const timer = this.timers.get(client);
    if (timer) clearInterval(timer);
    this.timers.delete(client);
  }
}
