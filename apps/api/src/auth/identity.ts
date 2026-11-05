import { and, type Database, eq, gt, isNull, schema, sql } from '@vipe/db';
import type { CallerProfile } from './auth-context';

export interface Identity {
  user: { id: string; email: string };
  profile: CallerProfile;
}

/**
 * Is the token's session still live (not revoked by logout, not expired)?
 * Read inside a request transaction; RLS on auth_sessions already limits this
 * to the caller's own rows.
 */
export async function hasLiveSession(db: Database, sessionId: string): Promise<boolean> {
  const [session] = await db
    .select({ id: schema.authSessions.id })
    .from(schema.authSessions)
    .where(
      and(
        eq(schema.authSessions.id, sessionId),
        isNull(schema.authSessions.revokedAt),
        gt(schema.authSessions.expiresAt, sql`now()`),
      ),
    );
  return session !== undefined;
}

/**
 * The caller's active profile, read inside a request transaction: the row
 * whose user_id is private.current_user_id() (app.user_id). RLS on profiles
 * applies, so this cannot see another tenant.
 */
export async function loadProfile(db: Database): Promise<CallerProfile | undefined> {
  const [profile] = await db
    .select({
      id: schema.profiles.id,
      name: schema.profiles.fullName,
      role: schema.profiles.role,
      restaurantId: schema.profiles.restaurantId,
    })
    .from(schema.profiles)
    .where(and(eq(schema.profiles.userId, sql`private.current_user_id()`), eq(schema.profiles.active, true)))
    .limit(1);
  return profile;
}

/** Body of login and me. Reads only the users columns vipe_api is granted. */
export async function loadIdentity(db: Database, userId: string): Promise<Identity | undefined> {
  const profile = await loadProfile(db);
  if (!profile) {
    return undefined;
  }
  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return user ? { user, profile } : undefined;
}
