// Simha Online control plane — NestJS bootstrap.
// Owns: sessions, signup/login, client keys, admin APIs, chat workbench APIs,
// OAuth broker, SMTP. The Go gateway consults it for OAuth upstream tokens.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  const port = parseInt(process.env.PORT || '8081', 10);
  app.use(json({ limit: '16mb' }));
  app.use(urlencoded({ extended: true }));
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
  console.log(`Simha control plane listening on :${port}`);
}
bootstrap();