import { BadRequestException, Body, Controller, Get, Header, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
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
import { UnitOfWork } from '../db/unit-of-work';
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
  TerminalUnlockRequest,
} from './auth.dto';
import { AuthService } from './auth.service';
import { ACCESS_COOKIE, clearAuthCookies, readCookie, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { authorizeSchema, changeOwnPinSchema, identifySchema, parsePinInput, terminalUnlockSchema } from './pins';
import { PinRefusal, PinsService } from './pins.service';
import { Public } from './public.decorator';

/** Session answers and cookies must never be stored by a browser or proxy cache. */
const NO_STORE = ['Cache-Control', 'no-store'] as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly pins: PinsService,
    private readonly uow: UnitOfWork,
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
  @ApiConflictResponse({
    description: 'Ese PIN no está disponible, elige otro (code pin_taken): another active member has the new PIN; never says whose. The attempt counts, also on a counter a later success does not clear. Code pin_check_unavailable above 200 PIN holders.',
  })
  @ApiTooManyRequestsResponse({ description: '5 failures lock the profile and the session 5 minutes (code pin_locked; lockedUntil: when the lock ends).' })
  @ApiUnprocessableEntityResponse({ description: 'Weak or malformed new PIN, or no PIN yet (Spanish message).' })
  async changeOwnPin(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const input = parsePinInput(changeOwnPinSchema, body);
    this.sendAfterCommit(res, 204, await this.pins.changeOwn(req.auth!, req.profile!, input.currentPin, input.pin));
  }

  @Post('identify')
  @Header(...NO_STORE)
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiBody({ type: IdentifyRequest })
  @ApiOkResponse({
    type: IdentifyResponse,
    description:
      'Terminal only: the acting-staff claim, valid 5 minutes. Without profileId the PIN is checked against the active admins, cashiers and waiters of the restaurant; the attempt counts on this terminal session.',
  })
  @ApiForbiddenResponse({
    description: 'Not a terminal session, or PIN incorrecto (code pin_invalid) for a wrong PIN, an unknown profile, another restaurant or no PIN alike.',
  })
  @ApiConflictResponse({
    description:
      'PIN only: more than one active member has that PIN (code pin_ambiguous), or more than 100 PIN holders (code pin_too_many, not counted as an attempt); nobody is identified.',
  })
  @ApiTooManyRequestsResponse({
    description: 'The profile or this terminal is locked for 5 minutes (code pin_locked; lockedUntil: when the lock ends).',
  })
  async identify(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const input = parsePinInput(identifySchema, body);
    this.sendAfterCommit(res, 200, await this.pins.identify(req.auth!, input.profileId, input.pin));
  }

  @Post('terminal/unlock')
  @Header(...NO_STORE)
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiBody({ type: TerminalUnlockRequest })
  @ApiNoContentResponse({ description: "Terminal only: an active admin or cashier's PIN lifts this terminal's PIN lock early. Logged." })
  @ApiForbiddenResponse({ description: 'Not a terminal session, or PIN incorrecto (code pin_invalid) for a wrong PIN, a non-supervisor or another restaurant alike.' })
  @ApiTooManyRequestsResponse({ description: 'That supervisor is locked for 5 minutes (code pin_locked; lockedUntil).' })
  @ApiUnprocessableEntityResponse({ description: 'Malformed profile id or PIN.' })
  async unlockTerminal(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const input = parsePinInput(terminalUnlockSchema, body);
    this.sendAfterCommit(res, 204, await this.pins.unlockTerminal(req.auth!, input.profileId, input.pin));
  }

  @Post('authorize')
  @Header(...NO_STORE)
  @ApiCookieAuth()
  @ApiBody({ type: AuthorizeRequest })
  @ApiCreatedResponse({ type: AuthorizeResponse, description: 'Single-use supervisor authorization for the action, valid 2 minutes.' })
  @ApiForbiddenResponse({ description: 'PIN incorrecto (code pin_invalid): no admin or cashier of the restaurant has that PIN.' })
  @ApiTooManyRequestsResponse({ description: 'The session or the named supervisor is locked for 5 minutes (code pin_locked; lockedUntil: when the lock ends).' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown action or malformed PIN.' })
  async authorize(@Req() req: AuthenticatedRequest, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const input = parsePinInput(authorizeSchema, body);
    this.sendAfterCommit(res, 201, await this.pins.authorize(req.auth!, input.action, input.pin, input.profileId, input));
  }

  /**
   * PIN routes answer only once the request transaction committed: a refused
   * attempt (403/429) is returned, not thrown, so its claim is not rolled
   * back, and an acting session or authorization exists before its id is
   * sent. Thrown errors still go through the exception filter.
   */
  private sendAfterCommit(res: Response, okStatus: number, result: object | undefined): void {
    const [status, body] = result instanceof PinRefusal ? [result.status, result.body] : [okStatus, result];
    this.uow.afterCommit(() => {
      res.setHeader(...NO_STORE);
      if (body === undefined) {
        res.status(status).send();
      } else {
        res.status(status).json(body);
      }
    });
  }
}

function parseLogin(body: unknown): { email: string; password: string } {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  return parsed.data;
}

