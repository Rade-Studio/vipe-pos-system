import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, createOpenApiDocument } from './configure-app';

/**
 * Write apps/api/openapi.json without listening: the app is created but never
 * initialized, so no database connection or realtime listener starts. The env
 * only has to validate; placeholders fill whatever is missing.
 *
 * Usage: pnpm --filter @vipe/api openapi
 */
async function main() {
  process.env.DATABASE_URL ??= 'postgres://openapi@localhost:5432/openapi';
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';
  process.env.JWT_SECRET ??= 'openapi-document-generation-placeholder';

  const app = configureApp(await NestFactory.create(AppModule, { logger: false }));
  const document = createOpenApiDocument(app);
  const target = path.resolve(__dirname, '../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
