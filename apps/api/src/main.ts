import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT: ${process.env.PORT ?? ''}`);
  }

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
