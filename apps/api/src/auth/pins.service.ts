import { createHmac } from 'node:crypto';
import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { Clock } from '../common/clock';
import { ENV, type Env } from '../config/env';
import { UnitOfWork } from '../db/unit-of-work';
import type { AuthContext, CallerProfile } from './auth-context';
import { PasswordsService } from './passwords.service';
import { ACTING_ROLES, ACTING_TTL_MS, PIN_MESSAGES, SUPERVISOR_ROLES, type SupervisorAction } from './pins';
import { TokensService } from './tokens.service';

interface PinTarget {
  pin_hash: string;
  locked_until: Date | string | null;
  role: string;
  eligible: boolean;
}

interface Candidate {
  profile_id: string;
  pin_hash: string;
  locked_until: Date | string | null;
}

export interface ActingIdentity {
  token: string;
  expiresAt: string;
  profile: { id: string; name: string; role: string };
}

export interface SupervisorAuthorization {
  authorizationId: string;
  action: SupervisorAction;
  supervisor: { id: string; name: string };
  expiresAt: string;
}

const wrongPin = () => new ForbiddenException({ message: PIN_MESSAGES.wrong, code: 'pin_invalid' });
const lockedPin = () =>
  new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: PIN_MESSAGES.locked, code: 'pin_locked' }, HttpStatus.TOO_MANY_REQUESTS);

/**
 * PIN checks (F2). The PIN is peppered with an HMAC keyed from JWT_SECRET and
 * hashed with argon2id here, so the database never sees it and a stolen
 * hash alone cannot be brute-forced over the 10^6 PIN space. Rotating
 * JWT_SECRET therefore invalidates every PIN (admins set them again).
 *
 * Every attempt first refuses a locked session (per terminal) or profile with
 * 429; a wrong PIN, an unknown profile, a profile of another restaurant or
 * one without a PIN all answer the same 403 `pin_invalid` after one argon2
 * verify. Failures are recorded in their own transaction (UnitOfWork.run), so
 * the request's rollback on the 403 does not undo the count.
 */
@Injectable()
export class PinsService {
  private readonly pepper: string;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly passwords: PasswordsService,
    private readonly tokens: TokensService,
    private readonly clock: Clock,
    @Inject(ENV) env: Env,
  ) {
    this.pepper = createHmac('sha256', env.jwtSecret).update('vipe-pin-pepper').digest('hex');
  }

  /** argon2id of the peppered PIN; the only form a PIN is stored in. */
  hash(pin: string): Promise<string> {
    return this.passwords.hash(this.peppered(pin));
  }

  /** Admin: set or reset a PIN (clears its lockout). */
  async setForStaff(profileId: string, pin: string): Promise<void> {
    const hash = await this.hash(pin);
    await this.uow.db.execute(sql`SELECT private.set_staff_pin(${profileId}::uuid, ${hash})`);
  }

  /** Admin: remove a PIN (no-op when none). */
  async clearForStaff(profileId: string): Promise<void> {
    await this.uow.db.execute(sql`SELECT private.clear_staff_pin(${profileId}::uuid)`);
  }

  /** The caller changes their own PIN with the current one. */
  async changeOwn(auth: AuthContext, caller: CallerProfile, currentPin: string, pin: string): Promise<void> {
    await this.assertSessionUnlocked(auth.sessionId);
    const target = await this.target(caller.id);
    if (!target) {
      throw new UnprocessableEntityException(PIN_MESSAGES.noPin);
    }
    await this.check(auth, caller.id, target, currentPin);
    const hash = await this.hash(pin);
    await this.uow.db.execute(sql`SELECT private.change_own_pin(${hash})`);
  }

  /** Terminal: a staff member identifies with their PIN and gets the acting claim. */
  async identify(auth: AuthContext, profileId: string, pin: string): Promise<ActingIdentity> {
    if (auth.kind !== 'terminal') {
      throw new ForbiddenException(PIN_MESSAGES.terminalOnly);
    }
    await this.assertSessionUnlocked(auth.sessionId);
    const target = await this.target(profileId);
    const usable = target && target.eligible && (ACTING_ROLES as readonly string[]).includes(target.role) ? target : undefined;
    await this.check(auth, profileId, usable, pin);
    const expiresAt = new Date(this.clock.now().getTime() + ACTING_TTL_MS);
    const refresh = this.tokens.newRefreshToken();
    const [session] = await this.rows<{ id: string }>(sql`
      SELECT private.open_acting_session(${auth.sessionId}::uuid, ${profileId}::uuid, ${refresh.hash}, ${expiresAt.toISOString()}::timestamptz) AS id`);
    const [profile] = await this.rows<{ id: string; name: string; role: string; user_id: string }>(sql`
      SELECT id, full_name AS name, role, user_id FROM public.profiles WHERE id = ${profileId}`);
    const token = await this.tokens.signActing(
      { userId: profile.user_id, sessionId: session.id, terminalSessionId: auth.sessionId },
      expiresAt,
    );
    return { token, expiresAt: expiresAt.toISOString(), profile: { id: profile.id, name: profile.name, role: profile.role } };
  }

  /**
   * A supervisor (SUPERVISOR_ROLES) PIN authorizes one action. With a profile
   * id only that supervisor is tried; without, every unlocked supervisor of
   * the restaurant (first match wins).
   */
  async authorize(auth: AuthContext, action: SupervisorAction, pin: string, profileId?: string): Promise<SupervisorAuthorization> {
    await this.assertSessionUnlocked(auth.sessionId);
    let supervisorId: string;
    if (profileId) {
      const target = await this.target(profileId);
      const usable = target && target.eligible && (SUPERVISOR_ROLES as readonly string[]).includes(target.role) ? target : undefined;
      await this.check(auth, profileId, usable, pin);
      supervisorId = profileId;
    } else {
      const now = this.clock.now();
      const candidates = (await this.rows<Candidate>(sql`
        SELECT profile_id, pin_hash, locked_until FROM private.supervisor_pin_candidates()`)).filter(
        (candidate) => !isLocked(candidate.locked_until, now),
      );
      let match: string | undefined;
      for (const candidate of candidates) {
        if (await this.passwords.verify(this.peppered(pin), { hash: candidate.pin_hash, algo: 'argon2id' })) {
          match = candidate.profile_id;
          break;
        }
      }
      if (candidates.length === 0) {
        await this.passwords.verify(this.peppered(pin), undefined);
      }
      if (!match) {
        await this.recordFailure(auth, null);
        throw wrongPin();
      }
      await this.recordSuccess(auth, match);
      supervisorId = match;
    }
    const [created] = await this.rows<{ id: string }>(sql`
      SELECT private.create_supervisor_authorization(${supervisorId}::uuid, ${action}, ${this.clock.now().toISOString()}::timestamptz) AS id`);
    // A row written by a function is not visible to the statement that called it: read it next.
    const [row] = await this.rows<{ id: string; expires_at: Date | string; name: string }>(sql`
      SELECT a.id, a.expires_at, p.full_name AS name
        FROM public.supervisor_authorizations a
        JOIN public.profiles p ON p.id = a.supervisor_profile_id
       WHERE a.id = ${created.id}`);
    return {
      authorizationId: row.id,
      action,
      supervisor: { id: supervisorId, name: row.name },
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  private peppered(pin: string): string {
    return createHmac('sha256', this.pepper).update(pin).digest('hex');
  }

  private async target(profileId: string): Promise<PinTarget | undefined> {
    const [target] = await this.rows<PinTarget>(sql`
      SELECT pin_hash, locked_until, role, eligible FROM private.pin_check_target(${profileId}::uuid)`);
    return target;
  }

  /** 429 while locked, else one verify; a mismatch is counted and answers 403. */
  private async check(auth: AuthContext, profileId: string, target: PinTarget | undefined, pin: string): Promise<void> {
    if (target && isLocked(target.locked_until, this.clock.now())) {
      throw lockedPin();
    }
    const valid = await this.passwords.verify(this.peppered(pin), target ? { hash: target.pin_hash, algo: 'argon2id' } : undefined);
    if (!target || !valid) {
      await this.recordFailure(auth, profileId);
      throw wrongPin();
    }
    await this.recordSuccess(auth, profileId);
  }

  private async assertSessionUnlocked(sessionId: string): Promise<void> {
    const [row] = await this.rows<{ until: Date | string | null }>(sql`SELECT private.session_pin_lock(${sessionId}::uuid) AS until`);
    if (isLocked(row?.until ?? null, this.clock.now())) {
      throw lockedPin();
    }
  }

  /** Own transaction: survives the rollback of the request that answers 403. */
  private async recordFailure(auth: AuthContext, profileId: string | null): Promise<void> {
    const now = this.clock.now().toISOString();
    await this.uow.run(auth.userId, (db) =>
      db.execute(sql`SELECT private.record_pin_failure(${auth.sessionId}::uuid, ${profileId}::uuid, ${now}::timestamptz)`),
    );
  }

  private async recordSuccess(auth: AuthContext, profileId: string): Promise<void> {
    await this.uow.db.execute(sql`SELECT private.record_pin_success(${auth.sessionId}::uuid, ${profileId}::uuid)`);
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

function isLocked(until: Date | string | null, now: Date): boolean {
  return until !== null && new Date(until).getTime() > now.getTime();
}
