import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'auth:roles';

/**
 * Restrict a route to app roles (profiles.role). Checked inside the request
 * unit of work against the caller's profile, never against token claims.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
