import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { DbClient } from '../db/db-client';
import { UnitOfWork } from '../db/unit-of-work';
import { NO_PROFILE_MESSAGE } from './auth-context';
import { type Identity, loadIdentity } from './identity';
import { PasswordsService } from './passwords.service';
import { TokensService } from './tokens.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

const INVALID_CREDENTIALS = 'Invalid credentials';
const INVALID_REFRESH = 'Invalid refresh token';

interface LoginRow {
  id: string;
  password_hash: string;
  password_algo: string;
  is_active: boolean;
}

/**
 * Login, refresh and logout run on public routes, before any app.user_id
 * exists, so they reach users and auth_sessions only through the SECURITY
 * DEFINER helpers of migration 0002; vipe_api cannot read password_hash.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly client: DbClient,
    private readonly uow: UnitOfWork,
    private readonly passwords: PasswordsService,
    private readonly tokens: TokensService,
  ) {}

  async login(email: string, password: string): Promise<{ identity: Identity; tokens: IssuedTokens }> {
    const { rows } = await this.client.pool.query<LoginRow>(
      'SELECT id, password_hash, password_algo, is_active FROM private.find_user_for_login($1)',
      [email],
    );
    const user = rows[0];
    // Unknown email, wrong password and inactive user all pay one hash verify
    // and leave through the same 401.
    const valid = await this.passwords.verify(
      password,
      user ? { hash: user.password_hash, algo: user.password_algo } : undefined,
    );
    if (!user || !valid || !user.is_active) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (user.password_algo !== 'argon2id') {
      await this.client.pool.query('SELECT private.set_password($1, $2, $3)', [
        user.id,
        await this.passwords.hash(password),
        'argon2id',
      ]);
    }

    const identity = await this.uow.run(user.id, (db) => loadIdentity(db, user.id));
    if (!identity) {
      throw new ForbiddenException(NO_PROFILE_MESSAGE);
    }
    return { identity, tokens: await this.openSession(user.id) };
  }

  /** Rotate the session behind a refresh token; the old token never matches again. */
  async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    const next = this.tokens.newRefreshToken();
    const { rows } = await this.client.pool.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM private.rotate_session($1, $2, $3)',
      [this.tokens.hashRefresh(refreshToken), next.hash, next.expiresAt],
    );
    const session = rows[0];
    if (!session) {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    return { accessToken: await this.tokens.signAccess(session.user_id, session.id), refreshToken: next.token };
  }

  /** Revoke by the refresh cookie, else by the sid of a valid access token. */
  async logout(refreshToken: string | undefined, accessToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.client.pool.query('SELECT private.revoke_session($1)', [this.tokens.hashRefresh(refreshToken)]);
      return;
    }
    if (accessToken) {
      const auth = await this.tokens.verifyAccess(accessToken).catch(() => undefined);
      if (auth) {
        await this.client.pool.query('SELECT private.revoke_session_by_id($1)', [auth.sessionId]);
      }
    }
  }

  /** Body of GET /auth/me, inside the request unit of work. */
  async me(userId: string): Promise<Identity> {
    const identity = await loadIdentity(this.uow.db, userId);
    if (!identity) {
      throw new ForbiddenException(NO_PROFILE_MESSAGE);
    }
    return identity;
  }

  private async openSession(userId: string): Promise<IssuedTokens> {
    const refresh = this.tokens.newRefreshToken();
    const { rows } = await this.client.pool.query<{ id: string }>(
      'SELECT private.create_session($1, $2, $3) AS id',
      [userId, refresh.hash, refresh.expiresAt],
    );
    return { accessToken: await this.tokens.signAccess(userId, rows[0].id), refreshToken: refresh.token };
  }
}
