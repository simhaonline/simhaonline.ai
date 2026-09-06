// Simha Online control plane — NestJS bootstrap.
// Owns: sessions, signup/login, client keys, admin APIs, chat workbench APIs,
// OAuth broker, SMTP, billing/Stripe. The Go gateway consults it for OAuth
// upstream tokens and reads plan quotas from Valkey.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { json, urlencoded } from 'express';
import type { Request as ExRequest, Response as ExResponse, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'], rawBody: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  const port = parseInt(process.env.PORT || '8081', 10);
  const allowedOrigins = (process.env.CORS_ORIGINS ||
    'https://simhaonline.ai,https://chat.simhaonline.ai,https://platform.simhaonline.ai,https://docs.simhaonline.ai,https://status.simhaonline.ai')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({ origin: allowedOrigins, credentials: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'] });
  app.use((_req: ExRequest, res: ExResponse, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });
  app.use(cookieParser());
  app.use(json({
    limit: '16mb',
    verify: (req: ExRequest & { rawBody?: Buffer }, _res, buf) => {
      // preserve raw body for Stripe webhook signature verification
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }));
  app.use(urlencoded({ extended: true }));
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
  console.log(`Simha control plane listening on :${port}`);
  // Bootstrap admin once the server is accepting connections.
  const authModule = app.select(AuthModule);
  const authService = authModule.get(AuthService);
  await authService.bootstrapAdmin();
}
bootstrap();
