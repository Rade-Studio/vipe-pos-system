import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ENV, type Env } from './config/env';
import { corsOptionsFor } from './desktop/desktop-cors';
import { RealtimeIoAdapter } from './realtime/realtime-io.adapter';

export const API_PREFIX = 'api';

/**
 * Apply the cross-cutting HTTP configuration shared by `main.ts` and the
 * integration specs: global prefix, CORS for the web origin (HTTP and the
 * socket.io realtime namespace) plus credential-less CORS for the desktop
 * app's pages on the device routes (desktop-cors.ts), OpenAPI document.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  const env = app.get<Env>(ENV);

  applyTrustProxy(app.getHttpAdapter().getInstance(), env.trustProxyHops);
  app.setGlobalPrefix(API_PREFIX);
  app.enableCors(corsOptionsFor(env.webOrigin));
  app.useWebSocketAdapter(new RealtimeIoAdapter(app, env.webOrigin));

  SwaggerModule.setup(`${API_PREFIX}/docs`, app, createOpenApiDocument(app));

  return app;
}

/**
 * Express `trust proxy` as a hop count: req.ip is the entry the Nth proxy from
 * the right appended to X-Forwarded-For, so addresses a client puts in that
 * header (to the left) are never used. 0 leaves Express's default (the socket
 * peer, header ignored).
 */
export function applyTrustProxy(http: { set(setting: string, value: unknown): unknown }, hops: number): void {
  if (hops > 0) {
    http.set('trust proxy', hops);
  }
}

/** The OpenAPI document served at /api/docs and written by `pnpm openapi`. */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('VIPE POS API').setVersion('0.1.0').addCookieAuth('vipe_access').addBearerAuth().build(),
  );
}
