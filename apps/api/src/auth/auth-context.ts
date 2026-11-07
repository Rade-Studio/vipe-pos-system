import type { Request } from 'express';

/** user: a personal login; terminal: a shared order-taking device; acting: staff identified by PIN on a terminal. */
export type SessionKind = 'user' | 'terminal' | 'acting';

/** Identity proven by the access JWT. Tenant and role are never read from the token. */
export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
  /** `knd` claim; absent means a personal login. */
  readonly kind?: 'terminal' | 'acting';
  /** For an acting request: the terminal session whose access cookie carried the claim. */
  readonly terminalSessionId?: string;
}

/** Caller's profile, resolved inside the request transaction from profiles.user_id. */
export interface CallerProfile {
  id: string;
  name: string;
  role: string;
  restaurantId: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
  profile?: CallerProfile;
}

export const NO_PROFILE_MESSAGE = 'No active profile for this account';
