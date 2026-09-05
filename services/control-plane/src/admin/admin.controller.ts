// Admin controller: /admin/api/* surface (legacy parity).
import { Controller, Get, Post, Patch, Delete, Req, Res, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../db/db.module';
import type Redis from 'ioredis';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';

const COOKIE = 'simha_session';

@Controller('admin/api')
export class AdminController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly auth: AuthService,
    private readonly admin: AdminService,
  ) {}

  private async requireUser(req: Request, roles?: string[]) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) {
      throw new HttpException({ error: 'Login required' }, HttpStatus.UNAUTHORIZED);
    }
    if (roles && !roles.includes(user.role)) {
      throw new HttpException({ error: 'Administrator login required' }, HttpStatus.UNAUTHORIZED);
    }
    return user;
  }

  @Get('overview')
  async overview(@Req() req: Request, @Res() res: Response) {
    const user = await this.requireUser(req, ['admin', 'operator']);
    if (user.role === 'operator') {
      const { rows } = await this.pool.query(`SELECT DISTINCT model FROM discovered_models ORDER BY model`);
      return res.json({
        models: rows.map((r) => r.model),
        auth: { admin: false, role: 'operator' },
        operator_scope: 'models_only',
      });
    }
    return res.json(await this.admin.overview());
  }

  @Post('models/refresh')
  async refreshModels(@Req() req: Request, @Res() res: Response) {
    await this.requireUser(req, ['admin', 'operator']);
    // Ask the gateway to refresh discovery (leader lock lives in Valkey).
    const gw = process.env.GATEWAY_URL || 'http://gateway:8080';
    try {
      const r = await fetch(`${gw}/internal/refresh-models`, { method: 'POST' });
      if (r.ok) {
        return res.status(HttpStatus.ACCEPTED).json({ ok: true, started: true });
      }
    } catch {
      // gateway unreachable — fall through to accepted (worker also refreshes)
    }
    return res.status(HttpStatus.ACCEPTED).json({ ok: true, started: true });
  }

  @Post('accounts')
  async addAccount(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    await this.requireUser(req, ['admin']);
    try {
      const row = await this.admin.addAccount(body);
      return res.status(HttpStatus.CREATED).json({ ok: true, account: row });
    } catch (err: unknown) {
      throw new HttpException(
        { error: (err as Error).message || 'invalid account' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Patch('accounts/*')
  async patchAccount(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    await this.requireUser(req, ['admin']);
    const name = decodeURIComponent(req.url.split('/admin/api/accounts/')[1] || '');
    await this.admin.modifyAccount(name, body);
    return res.json({ ok: true });
  }

  @Delete('accounts/*')
  async deleteAccount(@Req() req: Request, @Res() res: Response) {
    await this.requireUser(req, ['admin']);
    const name = decodeURIComponent(req.url.split('/admin/api/accounts/')[1] || '');
    await this.admin.removeAccount(name);
    return res.json({ ok: true });
  }

  @Get('users')
  async users(@Req() req: Request, @Res() res: Response) {
    await this.requireUser(req, ['admin']);
    return res.json({ users: await this.admin.listUsers() });
  }

  @Get('user-reports')
  async userReports(@Req() req: Request, @Res() res: Response) {
    await this.requireUser(req, ['admin']);
    return res.json(await this.admin.userReports());
  }

  @Patch('users/:id')
  async modifyUser(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: { active?: boolean; role?: string },
  ) {
    await this.requireUser(req, ['admin']);
    await this.admin.modifyUser(Number(id), body);
    return res.json({ ok: true });
  }

  @Delete('users/:id')
  async deleteUser(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    await this.requireUser(req, ['admin']);
    await this.admin.removeUser(Number(id));
    return res.json({ ok: true });
  }
}