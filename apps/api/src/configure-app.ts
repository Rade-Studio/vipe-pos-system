import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ENV, type Env } from './config/env';

export const API_PREFIX = 'api';

/**
 * Apply the cross-cutting HTTP configuration shared by `main.ts` and the
 * integration specs: global prefix, CORS for the web origin, OpenAPI document.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  const env = app.get<Env>(ENV);

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: env.webOrigin, credentials: true });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('VIPE POS API').setVersion('0.1.0').build(),
  );
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  return app;
}
