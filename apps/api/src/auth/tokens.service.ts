import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../config/env';
import type { AuthContext } from './auth-context';

/**
 * Access JWT (HS256, claims `sub` and `sid` only) and opaque refresh tokens.
 * Refresh tokens are 32 random bytes; only their sha256 is stored.
 * Built by AuthModule from ENV.
 */
export class TokensService {
  private readonly key: Uint8Array;

  constructor(private readonly env: Env) {
    this.key = new TextEncoder().encode(env.jwtSecret);
  }

  signAccess(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId })
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
    return { userId: payload.sub, sessionId: payload.sid };
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
