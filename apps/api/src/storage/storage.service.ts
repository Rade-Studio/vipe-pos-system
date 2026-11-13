import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, type OnApplicationShutdown, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import { ENV, type Env, type StorageEnv } from '../config/env';
import { UnitOfWork } from '../db/unit-of-work';
import { type createUploadSchema, extensionOf, type UploadFolder, type UploadTicket } from './storage.dto';

const UPLOAD_TTL_SECONDS = 300;
/** Characters of the keys this API issues; anything else (%, ?, #, \) is refused on delete. */
const SAFE_KEY = /^[A-Za-z0-9._/-]+$/;

/**
 * S3-compatible object storage (T12): MinIO in development, R2 or any S3
 * service in production, through plain S3 calls only. The browser uploads
 * with a presigned PUT under `<restaurantId>/...` and reads through the
 * public bucket URL; the API never proxies the bytes.
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly config: StorageEnv | null;
  private readonly client: S3Client | null;

  constructor(
    @Inject(ENV) env: Env,
    private readonly uow: UnitOfWork,
  ) {
    this.config = env.storage;
    this.client = env.storage
      ? new S3Client({
          endpoint: env.storage.endpoint,
          region: env.storage.region,
          forcePathStyle: env.storage.forcePathStyle,
          credentials: { accessKeyId: env.storage.accessKeyId, secretAccessKey: env.storage.secretAccessKey },
          // No SDK checksum headers in the presigned PUT: browsers do not send them
          // and not every S3-compatible store accepts them.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        })
      : null;
  }

  onApplicationShutdown(): void {
    this.client?.destroy();
  }

  /** `folder` is a closed list (dishes for POST /storage/uploads, carta for the carta admin's logo and cover). */
  async createUpload(
    input: Pick<z.infer<typeof createUploadSchema>, 'contentType' | 'size'>,
    folder: UploadFolder = 'dishes',
  ): Promise<UploadTicket> {
    const { config, client } = this.configured();
    const key = `${await this.restaurantId()}/${folder}/${randomUUID()}.${extensionOf(input.contentType)}`;
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: input.contentType, ContentLength: input.size }),
      // Signed, so the PUT must carry the declared type and exact size.
      { expiresIn: UPLOAD_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
    );
    return { uploadUrl, key, publicUrl: `${config.publicBaseUrl}/${key}` };
  }

  /** Deletes an object of the caller's restaurant by its public URL (idempotent). */
  async deleteObject(publicUrl: string): Promise<void> {
    const { config, client } = this.configured();
    const prefix = `${config.publicBaseUrl}/`;
    const key = publicUrl.startsWith(prefix) ? publicUrl.slice(prefix.length) : '';
    const segments = key.split('/');
    const tenant = `${await this.restaurantId()}/`;
    if (
      !SAFE_KEY.test(key) ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !key.startsWith(tenant)
    ) {
      throw new UnprocessableEntityException('Not an object of this restaurant');
    }
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }

  /** 503 before any input validation when no S3_* variable is set. */
  assertConfigured(): void {
    this.configured();
  }

  private configured(): { config: StorageEnv; client: S3Client } {
    if (!this.config || !this.client) {
      throw new ServiceUnavailableException('Storage is not configured');
    }
    return { config: this.config, client: this.client };
  }

  private async restaurantId(): Promise<string> {
    const { rows } = await this.uow.db.execute(sql`SELECT private.current_restaurant_id() AS id`);
    return rows[0].id as string;
  }
}
