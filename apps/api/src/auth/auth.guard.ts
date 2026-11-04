import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth-context';
import { ACCESS_COOKIE, readCookie } from './cookies';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokensService } from './tokens.service';

/**
 * Global guard: every route needs a valid `vipe_access` JWT unless marked
 * @Public(). It only proves identity ({userId, sessionId}); tenant and role
 * are resolved later, inside the request transaction.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
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
    try {
      req.auth = await this.tokens.verifyAccess(token);
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
    return true;
  }
}
