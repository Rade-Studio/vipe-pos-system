import { BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ENV, type Env } from '../config/env';
import type { AuthenticatedRequest } from './auth-context';
import {
  AuthorizeRequest,
  AuthorizeResponse,
  ChangeOwnPinRequest,
  IdentifyRequest,
  IdentifyResponse,
  loginSchema,
  LoginRequest,
  SessionResponse,
} from './auth.dto';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { authorizeSchema, changeOwnPinSchema, identifySchema, parsePinInput } from './pins';
import { PinsService } from './pins.service';
import { Public } from './public.decorator';

/** Session answers and cookies must never be stored by a browser or proxy cache. */
const NO_STORE = ['Cache-Control', 'no-store'] as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly pins: PinsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @Header(...NO_STORE)
  @HttpCode(200)
  @ApiBody({ type: LoginRequest })
  @ApiOkResponse({ type: SessionResponse, description: 'Sets the vipe_access and vipe_refresh cookies.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials (unknown email, wrong password or inactive user).' })
  @ApiForbiddenResponse({ description: 'Valid credentials but no active profile.' })
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    const { email, password } = parseLogin(body);
    const { identity, tokens } = await this.auth.login(email, password);
    setAuthCookies(res, this.env, tokens);
    return identity;
  }

  @Public()
  @Post('terminal/login')
  @Header(...NO_STORE)
  @HttpCode(200)
  @ApiBody({ type: LoginRequest })
  @ApiOkResponse({
    type: SessionResponse,
    description: 'Opens a shared order-taking terminal (sessionKind terminal): only the order-taking routes, no admin screens. Sets the same cookies.',
  })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @ApiForbiddenResponse({ description: 'Solo un administrador o cajero puede abrir una terminal compartida (or no active profile).' })
  async terminalLogin(@Body() body: unknown, @Res({ passthrough: true }) res: Response): Promise<SessionResponse> {
    const { email, password } = parseLogin(body);
    const { identity, tokens } = await this.auth.terminalLogin(email, password);
    setAuthCookies(res, this.env, tokens);
    return identity;
  }

  @Public()
  @Post('refresh')
  @Header(...NO_STORE)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Rotates the session and sets new vipe_access and vipe_refresh cookies.' })
  @ApiUnauthorizedResponse({ description: 'Refresh cookie missing, expired, revoked or already used.' })
  async refresh(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    setAuthCookies(res, this.env, await this.auth.refresh(readCookie(req, REFRESH_COOKIE)));
  }

  @Public()
  @Post('logout')
  @Header(...NO_STORE)
  @HttpCode(204)
  @ApiNoContentResponse({
    description: 'Revokes the session of the refresh cookie (or of the access token when no refresh cookie is sent) and clears both cookies.',
  })
  async logout(@Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, REFRESH_COOKIE), readCookie(req, ACCESS_COOKIE));
    clearAuthCookies(res, this.env);
  }

  @Get('me')
  @Header(...NO_STORE)
  @ApiCookieAuth()
  @ApiOkResponse({ type: SessionResponse })
  @ApiUnauthorizedResponse({ description: 'No valid access cookie.' })
  me(@Req() req: AuthenticatedRequest): Promise<SessionResponse> {
    // AuthGuard guarantees req.auth on non-public routes.
    return this.auth.me(req.auth!.userId, req.auth!.kind === 'terminal' ? 'terminal' : 'user');
  }

  @Put('pin')
  @Header(...NO_STORE)
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiBody({ type: ChangeOwnPinRequest })
  @ApiNoContentResponse({ description: 'The caller\'s PIN is replaced (the current one was right).' })
  @ApiForbiddenResponse({ description: 'PIN incorrecto (code pin_invalid; the failure counts), or a terminal session.' })
  @ApiTooManyRequestsResponse({ description: '5 failures lock the profile and the session 5 minutes (code pin_locked).' })
  @ApiUnprocessableEntityResponse({ description: 'Weak or malformed new PIN, or no PIN yet (Spanish message).' })
  changeOwnPin(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<void> {
    const input = parsePinInput(changeOwnPinSchema, body);
    return this.pins.changeOwn(req.auth!, req.profile!, input.currentPin, input.pin);
  }

  @Post('identify')
  @Header(...NO_STORE)
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiBody({ type: IdentifyRequest })
  @ApiOkResponse({ type: IdentifyResponse, description: 'Terminal only: the acting-staff claim, valid 5 minutes.' })
  @ApiForbiddenResponse({
    description: 'Not a terminal session, or PIN incorrecto (code pin_invalid) for a wrong PIN, an unknown profile, another restaurant or no PIN alike.',
  })
  @ApiTooManyRequestsResponse({ description: 'The profile or this terminal is locked for 5 minutes (code pin_locked).' })
  identify(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<IdentifyResponse> {
    const input = parsePinInput(identifySchema, body);
    return this.pins.identify(req.auth!, input.profileId, input.pin);
  }

  @Post('authorize')
  @Header(...NO_STORE)
  @ApiCookieAuth()
  @ApiBody({ type: AuthorizeRequest })
  @ApiCreatedResponse({ type: AuthorizeResponse, description: 'Single-use supervisor authorization for the action, valid 2 minutes.' })
  @ApiForbiddenResponse({ description: 'PIN incorrecto (code pin_invalid): no admin or cashier of the restaurant has that PIN.' })
  @ApiTooManyRequestsResponse({ description: 'The session or the named supervisor is locked for 5 minutes (code pin_locked).' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown action or malformed PIN.' })
  authorize(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<AuthorizeResponse> {
    const input = parsePinInput(authorizeSchema, body);
    return this.pins.authorize(req.auth!, input.action, input.pin, input.profileId);
  }
}

function parseLogin(body: unknown): { email: string; password: string } {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  return parsed.data;
}

