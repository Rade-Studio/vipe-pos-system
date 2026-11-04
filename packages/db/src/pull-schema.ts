import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Regenerate src/schema/{schema,relations}.ts from a migrated database.
 *
 * Usage: DATABASE_URL=postgres://vipe_migrator:...@localhost:5432/vipe_pos_test pnpm --filter @vipe/db schema:pull
 *
 * `drizzle-kit pull` writes a throwaway migration and snapshot next to the
 * schema, so it runs in a temp directory and only the two TypeScript files are
 * copied. Two drizzle-kit 0.31 defects are patched on the way: `citext`
 * columns come out as `unknown(...)` (rewritten to the custom type in
 * ./schema/citext) and an empty-string default comes out as `.default(')`.
 */
function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const pkgRoot = path.resolve(__dirname, '..');
  const schemaDir = path.join(pkgRoot, 'src', 'schema');
  const out = mkdtempSync(path.join(os.tmpdir(), 'vipe-db-pull-'));
  try {
    execFileSync(
      'pnpm',
      ['exec', 'drizzle-kit', 'pull', '--dialect', 'postgresql', '--url', url, '--out', out, '--schemaFilters', 'public'],
      { cwd: pkgRoot, stdio: 'inherit' },
    );
    const schema = readFileSync(path.join(out, 'schema.ts'), 'utf8')
      .replace(/\t\/\/ TODO: failed to parse database type 'citext'\n/g, '')
      .replace(/\bunknown\(/g, 'citext(')
      .replace(/\.default\('\)/g, ".default('')")
      .replace(/^(import \{ sql \} from "drizzle-orm")$/m, '$1\nimport { citext } from "./citext"');
    if (/\bunknown\(|TODO: failed to parse/.test(schema)) {
      throw new Error('drizzle-kit emitted an unmapped column type; extend pull-schema.ts');
    }
    writeFileSync(path.join(schemaDir, 'schema.ts'), schema);
    copyFileSync(path.join(out, 'relations.ts'), path.join(schemaDir, 'relations.ts'));
    console.log(`schema written to ${schemaDir}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

main();
