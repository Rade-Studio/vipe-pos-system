import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';
import { API_PREFIX, configureApp } from './configure-app';

async function bootstrap() {
  const app = configureApp(await NestFactory.create(AppModule));
  const env = app.get<Env>(ENV);
  await app.listen(env.port);
  Logger.log(`listening on http://localhost:${env.port}/${API_PREFIX}`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), undefined, 'Bootstrap');
  process.exit(1);
});
