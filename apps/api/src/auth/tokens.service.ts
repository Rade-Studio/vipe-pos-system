import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../config/env';
import type { AuthContext } from './auth-context';

/** Claims of the acting-staff token a terminal sends in X-Vipe-Acting. */
export interface ActingClaim {
  /** User of the identified staff member (the acting session's owner). */
  readonly userId: string;
  /** The acting session (auth_sessions kind = 'acting'). */
  readonly sessionId: string;
  /** The terminal session the claim was issued to. */
  readonly terminalSessionId: string;
}

/**
 * Access JWT (HS256, claims `sub` and `sid`, plus `knd: 'terminal'` for a
 * terminal session) and opaque refresh tokens. Refresh tokens are 32 random
 * bytes; only their sha256 is stored. Acting tokens are signed with a key
 * derived from the same secret but different, so one can never pass as an
 * access token (and the reverse). Built by AuthModule from ENV.
 */
export class TokensService {
  private readonly key: Uint8Array;

  private readonly actingKey: Uint8Array;

  constructor(private readonly env: Env) {
    this.key = new TextEncoder().encode(env.jwtSecret);
    this.actingKey = new TextEncoder().encode(createHash('sha256').update(`vipe-acting:${env.jwtSecret}`).digest('hex'));
  }

  signAccess(userId: string, sessionId: string, kind?: 'terminal'): Promise<string> {
    return new SignJWT(kind ? { sid: sessionId, knd: kind } : { sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${this.env.accessTokenTtlSeconds}s`)
      .sign(this.key);
  }

  /** Throws when the token is malformed, tampered, expired or lacks `sub`/`sid`. */
  async verifyAccess(token: string): Promise<AuthContext> {
    const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new Error('access token without sub or sid');
    }
    if (payload.knd !== undefined && payload.knd !== 'terminal') {
      throw new Error('access token with an unknown kind');
    }
    return payload.knd ? { userId: payload.sub, sessionId: payload.sid, kind: 'terminal' } : { userId: payload.sub, sessionId: payload.sid };
  }

  signActing(claim: ActingClaim, expiresAt: Date): Promise<string> {
    return new SignJWT({ sid: claim.sessionId, par: claim.terminalSessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claim.userId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.actingKey);
  }

  /** Throws when the acting token is malformed, tampered or expired. */
  async verifyActing(token: string): Promise<ActingClaim> {
    const { payload } = await jwtVerify(token, this.actingKey, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.par !== 'string') {
      throw new Error('acting token without sub, sid or par');
    }
    return { userId: payload.sub, sessionId: payload.sid, terminalSessionId: payload.par };
  }

  newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      hash: this.hashRefresh(token),
      expiresAt: new Date(Date.now() + this.env.refreshTokenTtlSeconds * 1000),
    };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
