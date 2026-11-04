import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import type { AuthenticatedRequest } from './auth-context';
import { loginSchema, LoginRequest, SessionResponse } from './auth.dto';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { Public } from './public.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiBody({ type: LoginRequest })
  @ApiOkResponse({ type: SessionResponse, description: 'Sets the vipe_access and vipe_refresh cookies.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials (unknown email, wrong password or inactive user).' })
  @ApiForbiddenResponse({ description: 'Valid credentials but no active profile.' })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
    }
    const { identity, tokens } = await this.auth.login(parsed.data.email, parsed.data.password);
    setAuthCookies(res, this.env, tokens);
    return identity;
  }

  @Public()
  @Post('refresh')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Rotates the session and sets new vipe_access and vipe_refresh cookies.' })
  @ApiUnauthorizedResponse({ description: 'Refresh cookie missing, expired, revoked or already used.' })
  async refresh(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    setAuthCookies(res, this.env, await this.auth.refresh(readCookie(req, REFRESH_COOKIE)));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'Revokes the session of the refresh cookie (or of the access token when no refresh cookie is sent) and clears both cookies.',
  })
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, REFRESH_COOKIE), readCookie(req, ACCESS_COOKIE));
    clearAuthCookies(res, this.env);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'No valid access cookie.' })
  me(@Req() req: AuthenticatedRequest): Promise<SessionResponse> {
    // AuthGuard guarantees req.auth on non-public routes.
    return this.auth.me(req.auth!.userId);
  }
}
