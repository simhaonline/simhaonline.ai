// Simha Online control plane — NestJS bootstrap.
// Owns: sessions, signup/login, client keys, admin APIs, chat workbench APIs,
// OAuth broker, SMTP. The Go gateway consults it for OAuth upstream tokens.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthModule } from './auth/auth.module';
import { AuthService } from './auth/auth.service';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  const port = parseInt(process.env.PORT || '8081', 10);
  app.use(cookieParser());
  app.use(json({ limit: '16mb' }));
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