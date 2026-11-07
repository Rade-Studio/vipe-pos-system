import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from '@vipe/db';
import { UnitOfWork } from '../db/unit-of-work';
import { CONFIG_KEYS } from '../settings/business-config';
import type { AuthContext, AuthenticatedRequest } from './auth-context';
import { ACCESS_COOKIE, readCookie } from './cookies';
import { PIN_MESSAGES } from './pins';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ACTING_HEADER, terminalRoute } from './terminal-access';
import { TokensService } from './tokens.service';

const actingRequired = () => new ForbiddenException({ message: PIN_MESSAGES.actingRequired, code: 'acting_required' });

/**
 * Global guard: every route needs a valid `vipe_access` JWT unless marked
 * @Public(). It only proves identity ({userId, sessionId}); tenant and role
 * are resolved later, inside the request transaction.
 *
 * A terminal session (F2) may call only the routes of terminal-access.ts
 * (else 403 `terminal_route`). On its order writes a valid X-Vipe-Acting
 * claim issued to this terminal swaps the identity to the acting session of
 * the identified staff member, so the request runs (RLS, role, recorded
 * waiter) as them; a missing, expired or foreign claim is 403
 * `acting_required` while waiter_access_mode = shared_terminal (a bad claim
 * always is). Personal sessions ignore the header.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly uow: UnitOfWork,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readCookie(req, ACCESS_COOKIE);
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }
    let auth: AuthContext;
    try {
      auth = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
    req.auth = auth;
    if (auth.kind === 'terminal') {
      await this.terminal(req, auth);
    }
    return true;
  }

  private async terminal(req: AuthenticatedRequest, auth: AuthContext): Promise<void> {
    const route = terminalRoute(req.method, (req.route as { path?: string } | undefined)?.path);
    if (!route) {
      throw new ForbiddenException({ message: PIN_MESSAGES.terminalRoute, code: 'terminal_route' });
    }
    if (!route.acting) {
      return;
    }
    const header = req.headers[ACTING_HEADER];
    if (typeof header === 'string' && header.length > 0) {
      const claim = await this.tokens.verifyActing(header).catch(() => undefined);
      if (!claim || claim.terminalSessionId !== auth.sessionId) {
        throw actingRequired();
      }
      req.auth = { userId: claim.userId, sessionId: claim.sessionId, kind: 'acting', terminalSessionId: auth.sessionId };
      return;
    }
    if ((await this.waiterAccessMode(auth.userId)) === 'shared_terminal') {
      throw actingRequired();
    }
  }

  /** waiter_access_mode of the terminal's restaurant (RLS scopes business_config to it). */
  private waiterAccessMode(userId: string): Promise<string> {
    const spec = CONFIG_KEYS.waiterAccessMode;
    return this.uow.run(userId, async (db) => {
      const { rows } = await db.execute(sql`SELECT value FROM public.business_config WHERE key = ${spec.key}`);
      const value = rows[0]?.value;
      return typeof value === 'string' ? spec.read(value) : spec.fallback;
    });
  }
}
