import { z } from 'zod';

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
});

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
  return {
    port: result.data.PORT,
    databaseUrl: result.data.DATABASE_URL,
    webOrigin: result.data.WEB_ORIGIN,
    jwtSecret: result.data.JWT_SECRET,
    cookieSecure: result.data.COOKIE_SECURE,
    accessTokenTtlSeconds: result.data.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: result.data.REFRESH_TOKEN_TTL_SECONDS,
  };
}
