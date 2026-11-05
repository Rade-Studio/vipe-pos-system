/**
 * Step 4 of the cut-over: copy dish images from Supabase Storage to the
 * S3-compatible store of the API and write the URL mapping import.sql reads.
 *
 *   SUPABASE_PUBLIC_STORAGE_URL=https://<ref>.supabase.co/storage/v1/object/public \
 *   S3_ENDPOINT=... S3_REGION=... S3_BUCKET=... S3_ACCESS_KEY_ID=... \
 *   S3_SECRET_ACCESS_KEY=... S3_PUBLIC_BASE_URL=... [S3_FORCE_PATH_STYLE=true] \
 *     pnpm --filter @vipe/db exec tsx migration-from-supabase/copy-storage.ts <export-dir>
 *
 * Reads <export-dir>/storage-objects.csv and dish-images.csv (export.sh) and
 * writes <export-dir>/mapping.csv (old_url,new_url,key,restaurant_id) and
 * storage-report.csv (status,restaurant_id,name,detail,old_url; one row per
 * dish image URL for copied, already_present, refused_type and failed).
 * import.sh refuses an export whose report has a failed row. Every dish whose image_url points at the `dishes` bucket
 * gets its object copied once per restaurant under the key the API issues,
 * `<restaurantId>/dishes/<uuid>.<ext>` (apps/api/src/storage). The uuid is
 * derived from the restaurant and the object name, so a second run computes
 * the same keys and skips objects already present with the same size
 * (resumable). Objects no dish references are reported, not copied; dishes
 * pointing at a missing object are reported and import.sql clears their
 * image_url. Exits 1 when any copy failed: do not import until it exits 0.
 * Design: odd/tasks/migracion-backend-nestjs.md, "Design: T14", step 4.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const BUCKET = 'dishes';
const PUBLIC_PATH = `/storage/v1/object/public/${BUCKET}/`;
/** Same rule as apps/api/src/storage/storage.dto.ts: image/* except SVG. */
const IMAGE_TYPE = /^image\/([a-z0-9][a-z0-9.+-]{0,49})$/i;
const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
};

type Row = Record<string, string>;
type ReportRow = { status: string; restaurant_id: string; name: string; detail: string; old_url?: string };

function log(message: string): void {
  console.error(`copy-storage: ${message}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log(`ERROR: ${name} is required`);
    process.exit(2);
  }
  return value;
}

/** RFC 4180 CSV with a header row, as written by psql \copy ... CSV HEADER. */
export function parseCsv(text: string): Row[] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  const [header, ...rows] = records;
  return rows.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ''])));
}

function toCsv(header: string[], rows: string[][]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [header.join(','), ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n';
}

/** Object name inside the bucket for a Supabase public URL, or null for any other URL. */
export function objectNameOf(imageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  const at = url.pathname.indexOf(PUBLIC_PATH);
  if (at < 0) return null;
  const encoded = url.pathname.slice(at + PUBLIC_PATH.length);
  if (encoded === '') return null;
  try {
    return encoded.split('/').map(decodeURIComponent).join('/');
  } catch {
    return null;
  }
}

/** Stable uuid (version 8, RFC 9562 custom) from the restaurant and the object name. */
export function stableUuid(restaurantId: string, name: string): string {
  const bytes = createHash('sha256').update(`${restaurantId}\n${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Content type and key extension, following the API rule; null when the object is not an allowed image. */
export function imageTypeOf(contentType: string | null, name: string): { contentType: string; ext: string } | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const match = IMAGE_TYPE.exec(type);
  if (match && !/^image\/svg/.test(type)) {
    const subtype = match[1];
    return { contentType: type, ext: subtype === 'jpeg' ? 'jpg' : subtype.replace(/[^a-z0-9]/g, '') };
  }
  // Supabase stores some uploads as application/octet-stream: trust a known image extension.
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
  const byExtension = EXTENSION_TYPES[fromName];
  if (byExtension && !match) return { contentType: byExtension, ext: fromName === 'jpeg' ? 'jpg' : fromName };
  return null;
}

function sourceUrlOf(base: string, name: string): string {
  return `${base}/${BUCKET}/${name.split('/').map(encodeURIComponent).join('/')}`;
}

async function fetchWithRetry(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { method, redirect: 'follow' });
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function targetSize(client: S3Client, bucket: string, key: string): Promise<number | null> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? null;
  } catch (error) {
    if (error instanceof NotFound || (error as { name?: string }).name === 'NotFound') return null;
    throw error;
  }
}

async function main(): Promise<void> {
  const exportDir = process.argv[2];
  if (!exportDir) {
    log('usage: copy-storage.ts <export-dir>');
    process.exit(2);
  }
  const sourceBase = requireEnv('SUPABASE_PUBLIC_STORAGE_URL').replace(/\/+$/, '');
  const bucket = requireEnv('S3_BUCKET');
  const publicBase = requireEnv('S3_PUBLIC_BASE_URL').replace(/\/+$/, '');
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'us-east-1',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: requireEnv('S3_ACCESS_KEY_ID'), secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY') },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const objects = new Set(
    parseCsv(readFileSync(join(exportDir, 'storage-objects.csv'), 'utf8'))
      .filter((row) => row.bucket_id === BUCKET)
      .map((row) => row.name),
  );
  const dishes = parseCsv(readFileSync(join(exportDir, 'dish-images.csv'), 'utf8'));
  log(`source ${sourceBase}/${BUCKET}, target bucket ${bucket} (${publicBase}); ${objects.size} objects, ${dishes.length} dishes with image_url`);

  // One copy per (restaurant, object); every image_url spelling that names it maps to the copy.
  const wanted = new Map<string, { restaurantId: string; name: string; oldUrls: Set<string> }>();
  const report: ReportRow[] = [];
  const referenced = new Set<string>();
  for (const dish of dishes) {
    const name = objectNameOf(dish.image_url);
    if (name === null) continue;
    referenced.add(name);
    if (!objects.has(name)) {
      report.push({ status: 'missing_object', restaurant_id: dish.restaurant_id, name, detail: `dish ${dish.id}`, old_url: dish.image_url });
      continue;
    }
    const id = `${dish.restaurant_id}\n${name}`;
    const entry = wanted.get(id) ?? { restaurantId: dish.restaurant_id, name, oldUrls: new Set<string>() };
    entry.oldUrls.add(dish.image_url);
    wanted.set(id, entry);
  }
  for (const name of objects) {
    if (!referenced.has(name)) report.push({ status: 'unreferenced', restaurant_id: '', name, detail: 'not copied' });
  }

  const mapping: string[][] = [];
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const { restaurantId, name, oldUrls } of wanted.values()) {
    const sourceUrl = sourceUrlOf(sourceBase, name);
    const record = (status: string, detail: string) => {
      for (const oldUrl of oldUrls) report.push({ status, restaurant_id: restaurantId, name, detail, old_url: oldUrl });
    };
    try {
      const head = await fetchWithRetry(sourceUrl, 'HEAD');
      if (!head.ok) throw new Error(`source answered HTTP ${head.status}`);
      const type = imageTypeOf(head.headers.get('content-type'), name);
      if (!type) {
        record('refused_type', head.headers.get('content-type') ?? 'no content type');
        continue;
      }
      const key = `${restaurantId}/dishes/${stableUuid(restaurantId, name)}.${type.ext}`;
      const sourceLength = Number(head.headers.get('content-length') ?? NaN);
      const existing = await targetSize(client, bucket, key);
      if (existing !== null && existing === sourceLength) {
        skipped += 1;
        record('already_present', key);
      } else {
        const response = await fetchWithRetry(sourceUrl, 'GET');
        if (!response.ok) throw new Error(`source answered HTTP ${response.status}`);
        const body = Buffer.from(await response.arrayBuffer());
        await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: type.contentType }));
        copied += 1;
        record('copied', `${key} (${body.length} bytes)`);
      }
      for (const oldUrl of oldUrls) mapping.push([oldUrl, `${publicBase}/${key}`, key, restaurantId]);
    } catch (error) {
      failed += 1;
      record('failed', error instanceof Error ? error.message : String(error));
    }
  }

  const mappingPath = join(exportDir, 'mapping.csv');
  writeFileSync(`${mappingPath}.tmp`, toCsv(['old_url', 'new_url', 'key', 'restaurant_id'], mapping));
  renameSync(`${mappingPath}.tmp`, mappingPath);
  writeFileSync(
    join(exportDir, 'storage-report.csv'),
    toCsv(['status', 'restaurant_id', 'name', 'detail', 'old_url'], report.map((r) => [r.status, r.restaurant_id, r.name, r.detail, r.old_url ?? ''])),
  );
  for (const row of report.filter((r) => r.status !== 'copied' && r.status !== 'already_present')) {
    log(`${row.status}: ${row.name}${row.restaurant_id ? ` (restaurant ${row.restaurant_id})` : ''} ${row.detail}`);
  }
  log(`copied ${copied}, already present ${skipped}, failed ${failed}; mapping rows ${mapping.length} -> ${mappingPath}`);
  client.destroy();
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
