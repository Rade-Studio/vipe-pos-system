import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  WEB_ORIGIN: z.url(),
});

export interface Env {
  readonly port: number;
  readonly databaseUrl: string;
  readonly webOrigin: string;
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
  };
}
