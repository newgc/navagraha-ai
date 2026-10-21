import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { APP_CONFIG, type AppConfig } from './config.js';

async function bootstrap() {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule));
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.API_PORT, config.API_HOST);
}

void bootstrap();
