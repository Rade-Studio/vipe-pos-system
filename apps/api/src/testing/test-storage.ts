import { CreateBucketCommand, PutBucketPolicyCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio';

/**
 * Chainguard's MinIO build pinned by digest (upstream stopped publishing
 * community images); the same digest as the `minio` service of
 * docker-compose.yml. Development and tests only: production points the S3_*
 * variables at any S3-compatible store.
 */
export const MINIO_IMAGE = 'cgr.dev/chainguard/minio@sha256:3c60a2a8c4d33409a9bc7a623a7fcbfb4605adc3d89422d2f53b3f673a6e5597';

export const TEST_BUCKET = 'vipe-test';

export interface TestStorage {
  /** S3_* variables pointing the API at the bucket (path-style, public-read). */
  readonly env: Record<string, string>;
  /** Admin client for assertions. */
  readonly s3: S3Client;
  stop(): Promise<void>;
}

/** Start a throwaway MinIO with one public-read bucket, as `minio-init` does in docker-compose.yml. */
export async function startTestStorage(): Promise<TestStorage> {
  const container: StartedMinioContainer = await new MinioContainer(MINIO_IMAGE).start();
  const endpoint = container.getConnectionUrl();
  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: container.getUsername(), secretAccessKey: container.getPassword() },
  });
  await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }));
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: TEST_BUCKET,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Principal: { AWS: ['*'] }, Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${TEST_BUCKET}/*`] },
        ],
      }),
    }),
  );
  return {
    env: {
      S3_ENDPOINT: endpoint,
      S3_REGION: 'us-east-1',
      S3_BUCKET: TEST_BUCKET,
      S3_ACCESS_KEY_ID: container.getUsername(),
      S3_SECRET_ACCESS_KEY: container.getPassword(),
      S3_PUBLIC_BASE_URL: `${endpoint}/${TEST_BUCKET}`,
      S3_FORCE_PATH_STYLE: 'true',
    },
    s3,
    stop: async () => {
      s3.destroy();
      await container.stop();
    },
  };
}
