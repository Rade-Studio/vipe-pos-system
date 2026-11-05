import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'supertest';
import { AppModule } from '../app.module';
import { configureApp } from '../configure-app';

export const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

/**
 * Build the real AppModule against a test database, connected as vipe_api.
 * `controllers` registers probe routes that exist only in the spec.
 */
export async function createTestApp(databaseUrl: string, controllers: Type[] = []): Promise<INestApplication> {
  process.env.DATABASE_URL = databaseUrl;
  process.env.WEB_ORIGIN = 'http://localhost:3000';
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.COOKIE_SECURE = 'false';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

/** Set-Cookie headers of a response, keyed by cookie name (the full header line as value). */
export function setCookies(res: Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return Object.fromEntries((raw ?? []).map((line) => [line.slice(0, line.indexOf('=')), line]));
}

/** `name=value` pair of a Set-Cookie line, ready for a Cookie request header. */
export function cookiePair(setCookieLine: string): string {
  return setCookieLine.split(';')[0];
}
