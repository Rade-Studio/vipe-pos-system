import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ENV, type Env } from './config/env';
import { RealtimeIoAdapter } from './realtime/realtime-io.adapter';

export const API_PREFIX = 'api';

/**
 * Apply the cross-cutting HTTP configuration shared by `main.ts` and the
 * integration specs: global prefix, CORS for the web origin (HTTP and the
 * socket.io realtime namespace), OpenAPI document.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  const env = app.get<Env>(ENV);

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors({ origin: env.webOrigin, credentials: true });
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, env.webOrigin));

  SwaggerModule.setup(`${API_PREFIX}/docs`, app, createOpenApiDocument(app));

  return app;
}

/** The OpenAPI document served at /api/docs and written by `pnpm openapi`. */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('VIPE POS API').setVersion('0.1.0').addCookieAuth('vipe_access').build(),
  );
}
