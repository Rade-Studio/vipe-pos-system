import { z } from 'zod';

/** An empty variable (e.g. `S3_ENDPOINT=` in a compose file) counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

/** Required together: setting some but not all of them is a configuration error. */
const S3_REQUIRED = ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'] as const;

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  WEB_ORIGIN: z.url(),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  COOKIE_SECURE: z
    .enum(['true', 'false'], { message: 'must be true or false' })
    .default('true')
    .transform((value) => value === 'true'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  S3_ENDPOINT: optional(z.url({ protocol: /^https?$/, message: 'must be an http(s) URL' })),
  S3_REGION: optional(z.string()),
  S3_BUCKET: optional(z.string()),
  S3_ACCESS_KEY_ID: optional(z.string()),
  S3_SECRET_ACCESS_KEY: optional(z.string()),
  S3_PUBLIC_BASE_URL: optional(z.url({ protocol: /^https?$/, message: 'must be an http(s) URL' })),
  S3_FORCE_PATH_STYLE: optional(z.enum(['true', 'false'], { message: 'must be true or false' })),
  DESKTOP_RELEASES_BASE_URL: optional(z.url({ protocol: /^https?$/, message: 'must be an http(s) URL' })),
  TRUST_PROXY_HOPS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number({ message: 'must be an integer from 0 to 5' }).int('must be an integer from 0 to 5').min(0).max(5).default(0),
  ),
});

/** S3-compatible object storage (MinIO in development, R2 or any S3 service in production). */
export interface StorageEnv {
  /** Absent for AWS S3 itself. */
  readonly endpoint: string | undefined;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Public read URL of the bucket, without a trailing slash; object URLs are `<base>/<key>`. */
  readonly publicBaseUrl: string;
  /** `<endpoint>/<bucket>/<key>` addressing (MinIO) instead of `<bucket>.<endpoint>`. */
  readonly forcePathStyle: boolean;
}

export interface Env {
  readonly port: number;
  readonly databaseUrl: string;
  readonly webOrigin: string;
  /** HS256 key for the access JWT. */
  readonly jwtSecret: string;
  /** Adds `Secure` to the auth cookies; false only for plain-http local development. */
  readonly cookieSecure: boolean;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  /** Null when no S3 variable is set: the storage endpoints answer 503. */
  readonly storage: StorageEnv | null;
  /**
   * Public base URL of the desktop app builds (F5a), without a trailing slash;
   * an update's url is `<base>/<desktop_releases.file>`. Null: GET
   * /desktop/updates always answers 204 (no update offered).
   */
  readonly desktopReleasesBaseUrl: string | null;
  /**
   * Reverse proxies in front of the API whose X-Forwarded-For entry Express
   * trusts for req.ip (pairing limits per client). 0 (default) ignores the
   * header; 1 behind a single Traefik or Caddy, as the compose files set.
   */
  readonly trustProxyHops: number;
}

/** Injection token for the validated environment. */
export const ENV = Symbol('ENV');

/**
 * Validate the raw environment and map it to a typed, camelCase config.
 * Throws a single error naming every invalid variable, so a misconfigured
 * deployment fails at startup instead of at the first request.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const s3 = result.data;
  const anyS3 = Object.keys(s3).some((key) => key.startsWith('S3_') && s3[key as keyof typeof s3] !== undefined);
  const missing = S3_REQUIRED.filter((key) => s3[key] === undefined);
  if (anyS3 && missing.length) {
    throw new Error(`Invalid environment: ${missing.map((key) => `${key}: required when S3 storage is configured`).join('; ')}`);
  }
  return {
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    webOrigin: result.data.WEB_ORIGIN,
    jwtSecret: result.data.JWT_SECRET,
    cookieSecure: result.data.COOKIE_SECURE,
    accessTokenTtlSeconds: result.data.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: result.data.REFRESH_TOKEN_TTL_SECONDS,
    storage: anyS3
      ? {
          endpoint: s3.S3_ENDPOINT,
          region: s3.S3_REGION ?? 'us-east-1',
          bucket: s3.S3_BUCKET!,
          accessKeyId: s3.S3_ACCESS_KEY_ID!,
          secretAccessKey: s3.S3_SECRET_ACCESS_KEY!,
          publicBaseUrl: s3.S3_PUBLIC_BASE_URL!.replace(/\/+$/, ''),
          forcePathStyle: s3.S3_FORCE_PATH_STYLE === 'true',
        }
      : null,
    desktopReleasesBaseUrl: result.data.DESKTOP_RELEASES_BASE_URL?.replace(/\/+$/, '') ?? null,
    trustProxyHops: result.data.TRUST_PROXY_HOPS,
  };
}
