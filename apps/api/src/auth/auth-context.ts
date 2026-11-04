import type { Request } from 'express';

/** Identity proven by the access JWT. Tenant and role are never read from the token. */
export interface AuthContext {
  readonly userId: string;
  readonly sessionId: string;
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
