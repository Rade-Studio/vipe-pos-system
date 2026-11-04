import {
  type CallHandler,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull, schema, sql } from '@vipe/db';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { type AuthenticatedRequest, NO_PROFILE_MESSAGE } from '../auth/auth-context';
import { loadProfile } from '../auth/identity';
import { ROLES_KEY } from '../auth/roles.decorator';
import { UnitOfWork } from '../db/unit-of-work';

/**
 * Wraps every authenticated request in one transaction (UnitOfWork.run) with
 * app.user_id set to the JWT subject, so RLS scopes every query to the caller.
 *
 * Tenant and role checks live here, not in a Nest guard: guards run before
 * interceptors, and the role must come from private.current_app_role()'s
 * source (profiles.user_id) inside this transaction. The token's session must
 * still be live (not revoked by logout, not expired), else 401; a caller
 * without an active profile gets 403; a role outside @Roles(...) gets 403.
 * Public routes have no req.auth and pass through untouched.
 */
@Injectable()
export class UnitOfWorkInterceptor implements NestInterceptor {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = req.auth;
    if (!auth) {
      return next.handle();
    }
    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return defer(() =>
      this.uow.run(auth.userId, async (db) => {
        // RLS on auth_sessions already limits this to the caller's own rows.
        const [session] = await db
          .select({ id: schema.authSessions.id })
          .from(schema.authSessions)
          .where(
            and(
              eq(schema.authSessions.id, auth.sessionId),
              isNull(schema.authSessions.revokedAt),
              gt(schema.authSessions.expiresAt, sql`now()`),
            ),
          );
        if (!session) {
          throw new UnauthorizedException('Session revoked or expired');
        }
        const profile = await loadProfile(db);
        if (!profile) {
          throw new ForbiddenException(NO_PROFILE_MESSAGE);
        }
        if (roles?.length && !roles.includes(profile.role)) {
          throw new ForbiddenException('Insufficient role');
        }
        req.profile = profile;
        return lastValueFrom(next.handle(), { defaultValue: undefined });
      }),
    );
  }
}
