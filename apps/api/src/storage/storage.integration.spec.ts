import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cookiePair, createTestApp, setCookies } from '../testing/test-app';
import { PASSWORD, fixtures, startTestDatabase, type TestDatabase } from '../testing/test-database';
import { startTestStorage, TEST_BUCKET, type TestStorage } from '../testing/test-storage';

const MB = 1024 * 1024;
const S3_VARS = [
  'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL', 'S3_FORCE_PATH_STYLE',
];
/** A 1x1 PNG. */
const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);

async function loginCookies(app: INestApplication, users: { email: string }[]): Promise<Record<string, string>> {
  const cookies: Record<string, string> = {};
  for (const user of users) {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    cookies[user.email] = cookiePair(setCookies(res).vipe_access);
  }
  return cookies;
}

describe('object storage (Testcontainers: Postgres + MinIO, vipe_api)', () => {
  let database: TestDatabase;
  let storage: TestStorage;
  let app: INestApplication;
  let cookies: Record<string, string>;

  beforeAll(async () => {
    [database, storage] = await Promise.all([startTestDatabase(), startTestStorage()]);
    Object.assign(process.env, storage.env);
    app = await createTestApp(database.apiUrl);
    cookies = await loginCookies(app, [fixtures.adminA, fixtures.waiterA, fixtures.adminB]);
  });

  afterAll(async () => {
    for (const name of S3_VARS) {
      delete process.env[name];
    }
    await app?.close();
    await Promise.all([database?.stop(), storage?.stop()]);
  });

  const post = (user: { email: string }, url: string, body: object) =>
    request(app.getHttpServer()).post(url).set('Cookie', cookies[user.email]).send(body);
  const del = (user: { email: string }, url: string, body: object) =>
    request(app.getHttpServer()).delete(url).set('Cookie', cookies[user.email]).send(body);
  const exists = async (key: string) =>
    storage.s3.send(new HeadObjectCommand({ Bucket: TEST_BUCKET, Key: key })).then(
      () => true,
      () => false,
    );
  const presign = (user: { email: string } = fixtures.adminA, body: object = { kind: 'dish', contentType: 'image/png', size: PNG.length }) =>
    post(user, '/api/storage/uploads', body);

  it('presigns a PUT under <restaurantId>/dishes/<uuid>.<ext>; the upload is publicly readable, then deleted', async () => {
    const res = await presign();
    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(['key', 'publicUrl', 'uploadUrl']);
    expect(res.body.key).toMatch(new RegExp(`^${fixtures.restaurantA}/dishes/[0-9a-f-]{36}\\.png$`));
    expect(res.body.publicUrl).toBe(`${storage.env.S3_PUBLIC_BASE_URL}/${res.body.key}`);

    const put = await fetch(res.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG });
    expect(put.status).toBe(200);

    const read = await fetch(res.body.publicUrl);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(PNG);

    const removed = await del(fixtures.adminA, '/api/storage/objects', { publicUrl: res.body.publicUrl });
    expect(removed.status).toBe(204);
    expect(await exists(res.body.key)).toBe(false);
    expect((await fetch(res.body.publicUrl)).status).toBe(404);
  });

  it('maps the image type to the extension (jpeg -> jpg) and keys B under its own prefix', async () => {
    const res = await presign(fixtures.adminB, { kind: 'dish', contentType: 'image/jpeg', size: 100 });
    expect(res.status).toBe(201);
    expect(res.body.key).toMatch(new RegExp(`^${fixtures.restaurantB}/dishes/[0-9a-f-]{36}\\.jpg$`));
  });

  it('binds the presigned URL to the declared type and size', async () => {
    const res = await presign();
    const otherType = await fetch(res.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: PNG });
    expect(otherType.status).toBe(403);
    const bigger = await fetch(res.body.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array([...PNG, ...new Uint8Array(10)]),
    });
    expect(bigger.status).toBe(403);
    const smaller = await fetch(res.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PNG.slice(0, -1) });
    expect(smaller.status).toBe(403);
    expect(await exists(res.body.key)).toBe(false);
  });

  it.each([
    [{ kind: 'dish', contentType: 'application/pdf', size: 100 }, 'Only image uploads are allowed'],
    [{ kind: 'dish', contentType: 'image/svg+xml', size: 100 }, 'Only image uploads are allowed'],
    [{ kind: 'dish', contentType: 'image/png', size: 6 * MB }, 'Images are limited to 5 MB'],
    [{ kind: 'dish', contentType: 'image/png', size: 5 * MB + 1 }, 'Images are limited to 5 MB'],
  ])('refuses %o with 422', async (body, message) => {
    const res = await presign(fixtures.adminA, body);
    expect(res.status).toBe(422);
    expect(res.body.message).toContain(message);
  });

  it('accepts exactly 5 MB and refuses other kinds, sizes and unknown fields', async () => {
    expect((await presign(fixtures.adminA, { kind: 'dish', contentType: 'image/webp', size: 5 * MB })).status).toBe(201);
    for (const body of [
      { kind: 'avatar', contentType: 'image/png', size: 1 },
      { kind: 'dish', contentType: 'image/png', size: 0 },
      { kind: 'dish', contentType: 'image/png', size: 1.5 },
      { kind: 'dish', contentType: 'image/png', size: 1, key: 'x' },
    ]) {
      expect((await presign(fixtures.adminA, body)).status).toBe(422);
    }
  });

  it('is admin only', async () => {
    expect((await presign(fixtures.waiterA)).status).toBe(403);
    expect((await del(fixtures.waiterA, '/api/storage/objects', { publicUrl: `${storage.env.S3_PUBLIC_BASE_URL}/x` })).status).toBe(403);
  });

  it("refuses to delete another restaurant's object, a foreign host and traversal; the object stays", async () => {
    const foreignKey = `${fixtures.restaurantB}/dishes/00000000-0000-0000-0000-000000000001.png`;
    await storage.s3.send(new PutObjectCommand({ Bucket: TEST_BUCKET, Key: foreignKey, Body: PNG, ContentType: 'image/png' }));
    const base = storage.env.S3_PUBLIC_BASE_URL;
    for (const publicUrl of [
      `${base}/${foreignKey}`,
      `${base}/${fixtures.restaurantA}/../${foreignKey}`,
      `${base}/${fixtures.restaurantA}/dishes/..%2F..%2F${foreignKey.replace(/\//g, '%2F')}`,
      `https://evil.example/${TEST_BUCKET}/${fixtures.restaurantA}/dishes/x.png`,
      `${base}-other/${fixtures.restaurantA}/dishes/x.png`,
      `${base}/${fixtures.restaurantA}/dishes/x.png?versionId=1`,
      `${base}/${fixtures.restaurantA}/%2e%2e/${foreignKey}`,
      `${base}/${fixtures.restaurantA}/dishes/x.png#fragment`,
      `${base}/${fixtures.restaurantA}/dishes\\..\\..\\${foreignKey}`,
      `${base}/${fixtures.restaurantA}//dishes/x.png`,
      `${base}/${fixtures.restaurantA.toUpperCase()}/dishes/x.png`,
      'not a url',
    ]) {
      const res = await del(fixtures.adminA, '/api/storage/objects', { publicUrl });
      expect(res.status, publicUrl).toBe(422);
    }
    expect(await exists(foreignKey)).toBe(true);
    expect((await del(fixtures.adminB, '/api/storage/objects', { publicUrl: `${base}/${foreignKey}` })).status).toBe(204);
    expect(await exists(foreignKey)).toBe(false);
  });
});

describe('object storage without S3 configuration', () => {
  let database: TestDatabase;
  let app: INestApplication;
  let cookies: Record<string, string>;

  beforeAll(async () => {
    for (const name of S3_VARS) {
      delete process.env[name];
    }
    database = await startTestDatabase();
    app = await createTestApp(database.apiUrl);
    cookies = await loginCookies(app, [fixtures.adminA]);
  });

  afterAll(async () => {
    await app?.close();
    await database?.stop();
  });

  it('boots and answers 503 Storage is not configured on both endpoints', async () => {
    const server = () => request(app.getHttpServer());
    const upload = await server()
      .post('/api/storage/uploads')
      .set('Cookie', cookies[fixtures.adminA.email])
      .send({ kind: 'dish', contentType: 'image/png', size: 10 });
    expect(upload.status).toBe(503);
    expect(upload.body).toEqual({ statusCode: 503, error: 'Service Unavailable', message: 'Storage is not configured' });
    const remove = await server()
      .delete('/api/storage/objects')
      .set('Cookie', cookies[fixtures.adminA.email])
      .send({ publicUrl: 'http://x/y' });
    expect(remove.status).toBe(503);
    expect((await server().get('/api/health')).status).toBe(200);
  });
});
