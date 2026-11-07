import { createHmac } from 'node:crypto';
import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { Clock } from '../common/clock';
import { ENV, type Env } from '../config/env';
import { UnitOfWork } from '../db/unit-of-work';
import type { AuthContext, CallerProfile } from './auth-context';
import { PasswordsService } from './passwords.service';
import {
  ACTING_ROLES,
  ACTING_TTL_MS,
  type AuthorizationTarget,
  IDENTIFY_CANDIDATES_MAX,
  PIN_MESSAGES,
  SUPERVISOR_ROLES,
  type SupervisorAction,
  UNIQUE_PIN_CHECK_MAX,
} from './pins';
import { TokensService } from './tokens.service';

/** Counters an attempt claims (private.claim_pin_attempt, 0017). */
type Scope = 'session' | 'caller' | 'profile' | 'supervisors';

/**
 * F4b: a PIN-only identify counts only on the terminal session, so 5 wrong
 * PINs lock that tablet alone, never the other tablets of the restaurant.
 */
const TABLET_SCOPES: Scope[] = ['session'];

/** 1: pepper derived from JWT_SECRET; 2: PIN_PEPPER. */
type PepperVersion = 1 | 2;

interface StoredPin {
  pin_hash: string;
  pepper_version: number;
}

interface PinTarget extends StoredPin {
  role: string;
  eligible: boolean;
}

interface Candidate extends StoredPin {
  profile_id: string;
}

export interface ActingIdentity {
  token: string;
  expiresAt: string;
  profile: { id: string; name: string; role: string };
}

export interface SupervisorAuthorization {
  authorizationId: string;
  action: SupervisorAction;
  targetType: AuthorizationTarget;
  targetId: string;
  supervisor: { id: string; name: string };
  expiresAt: string;
}

/**
 * A refused PIN attempt, returned (not thrown) so the request transaction
 * commits the claimed attempt; the controller sends it after the commit.
 */
export class PinRefusal {
  private constructor(
    readonly status: 403 | 409 | 429,
    readonly body: { statusCode: number; error: string; message: string; code: string; lockedUntil?: string },
  ) {}

  static wrong(): PinRefusal {
    return new PinRefusal(403, { statusCode: 403, error: 'Forbidden', message: PIN_MESSAGES.wrong, code: 'pin_invalid' });
  }

  /** F4b: two active members share the PIN (legacy duplicate); nobody is identified. */
  static ambiguous(): PinRefusal {
    return new PinRefusal(409, { statusCode: 409, error: 'Conflict', message: PIN_MESSAGES.ambiguous, code: 'pin_ambiguous' });
  }

  /** F4b: the new PIN is another active member's (never says whose). */
  static taken(): PinRefusal {
    return new PinRefusal(409, { statusCode: 409, error: 'Conflict', message: PIN_MESSAGES.taken, code: 'pin_taken' });
  }

  /** `lockedUntil`: the latest end of the claimed locks, for the terminal's "Bloqueado hasta hh:mm". */
  static locked(until: Date | string): PinRefusal {
    return new PinRefusal(429, {
      statusCode: 429,
      error: 'Too Many Requests',
      message: PIN_MESSAGES.locked,
      code: 'pin_locked',
      lockedUntil: new Date(until).toISOString(),
    });
  }
}

/** Minimum length of PIN_PEPPER when it is set. */
const MIN_PEPPER = 32;

/**
 * PIN checks (F2). The PIN is peppered with an HMAC and hashed with argon2id
 * here, so the database never sees it and a stolen hash alone cannot be
 * brute-forced over the 10^6 PIN space. Pepper v2 is the optional PIN_PEPPER;
 * without it v1 (derived from JWT_SECRET) is used and a warning is logged
 * once. A correct v1 PIN is re-hashed to v2 when PIN_PEPPER is set.
 *
 * Every attempt is first claimed in the database (private.claim_pin_attempt):
 * the counters are incremented under row locks BEFORE argon2 runs, so at most
 * 5 PINs per scope and window are ever verified, also in parallel; while a
 * scope is locked the answer is 429 and nothing is verified. A wrong PIN, an
 * unknown profile, a profile of another restaurant or one without a PIN all
 * answer the same 403 `pin_invalid` after one argon2 verify. Refusals are
 * returned, not thrown, so the request transaction commits the claim on its
 * own connection (no second connection from the pool).
 */
@Injectable()
export class PinsService {
  private readonly peppers: Partial<Record<PepperVersion, string>>;

  private readonly current: PepperVersion;

  private readonly logger = new Logger('PinsService');

  constructor(
    private readonly uow: UnitOfWork,
    private readonly passwords: PasswordsService,
    private readonly tokens: TokensService,
    private readonly clock: Clock,
    @Inject(ENV) env: Env,
  ) {
    // Read here, not in config/env.ts: PIN_PEPPER is optional and only this service uses it.
    const pinPepper = process.env.PIN_PEPPER?.trim() || undefined;
    if (pinPepper !== undefined && pinPepper.length < MIN_PEPPER) {
      throw new Error(`PIN_PEPPER must be at least ${MIN_PEPPER} characters`);
    }
    this.peppers = { 1: createHmac('sha256', env.jwtSecret).update('vipe-pin-pepper').digest('hex') };
    if (pinPepper) {
      this.peppers[2] = createHmac('sha256', pinPepper).update('vipe-pin-pepper').digest('hex');
    } else {
      this.logger.warn('PIN_PEPPER is not set: PINs use the pepper derived from JWT_SECRET (rotating it invalidates every PIN)');
    }
    this.current = pinPepper ? 2 : 1;
  }

  /** Admin: set or reset a PIN (clears its lockout); 409 `pin_taken` when another active member has it. */
  async setForStaff(profileId: string, pin: string): Promise<void> {
    if (await this.taken(profileId, pin)) {
      const taken = PinRefusal.taken().body;
      throw new ConflictException({ message: taken.message, code: taken.code });
    }
    const hash = await this.hash(pin);
    await this.uow.db.execute(sql`SELECT private.set_staff_pin(${profileId}::uuid, ${hash}, ${this.current}::smallint)`);
  }

  /** Admin: remove a PIN (no-op when none). */
  async clearForStaff(profileId: string): Promise<void> {
    await this.uow.db.execute(sql`SELECT private.clear_staff_pin(${profileId}::uuid)`);
  }

  /**
   * Admin: end a profile's PIN lockout before its 5 minutes and forget its
   * failed attempts; the PIN stays. Only the profile counter is cleared (a
   * terminal that guessed stays locked on its own). 404 for a profile of
   * another restaurant; the unlock is logged with both profile ids.
   */
  async unlockForStaff(admin: CallerProfile, profileId: string): Promise<void> {
    const [profile] = await this.rows<{ id: string }>(sql`SELECT id FROM public.profiles WHERE id = ${profileId}::uuid`);
    if (!profile) {
      throw new NotFoundException('Staff member not found');
    }
    await this.uow.db.execute(sql`SELECT private.clear_pin_attempts(NULL, ${profileId}::uuid, ARRAY['profile']::text[])`);
    this.logger.log(`PIN unlocked early: profile ${profileId} by admin ${admin.id}`);
  }

  /**
   * The caller changes their own PIN with the current one. A new PIN another
   * active member has is refused (409 `pin_taken`) and, like a wrong PIN,
   * keeps its claimed attempt, so probing which PINs are in use is bounded by
   * the same lockout.
   */
  async changeOwn(auth: AuthContext, caller: CallerProfile, currentPin: string, pin: string): Promise<PinRefusal | undefined> {
    const target = await this.target(caller.id);
    if (!target) {
      throw new UnprocessableEntityException(PIN_MESSAGES.noPin);
    }
    const scopes: Scope[] = ['session', 'profile'];
    const locked = await this.claim(auth, caller.id, scopes);
    if (locked) {
      return locked;
    }
    if (!(await this.matches(currentPin, target))) {
      return PinRefusal.wrong();
    }
    if (await this.taken(caller.id, pin)) {
      return PinRefusal.taken();
    }
    await this.clear(auth, caller.id, scopes);
    const hash = await this.hash(pin);
    await this.uow.db.execute(sql`SELECT private.change_own_pin(${hash}, ${this.current}::smallint)`);
    return undefined;
  }

  /**
   * Terminal: a staff member identifies with their PIN and gets the acting
   * claim. With a profile id (F4) only that profile is tried (scopes session
   * and profile). Without (F4b) every PIN of the restaurant's active admins,
   * cashiers and waiters is verified (at most IDENTIFY_CANDIDATES_MAX); the
   * attempt counts on this terminal session only. Two matches refuse with
   * 409 `pin_ambiguous` and nobody is identified.
   */
  async identify(auth: AuthContext, profileId: string | undefined, pin: string): Promise<ActingIdentity | PinRefusal> {
    if (auth.kind !== 'terminal') {
      throw new ForbiddenException(PIN_MESSAGES.terminalOnly);
    }
    if (profileId) {
      const target = await this.target(profileId);
      const usable = target && target.eligible && (ACTING_ROLES as readonly string[]).includes(target.role) ? target : undefined;
      const refusal = await this.attempt(auth, profileId, ['session', 'profile'], () => this.matches(pin, usable));
      if (refusal) {
        return refusal;
      }
      await this.upgrade(profileId, pin, usable!);
      return this.openActing(auth, profileId);
    }
    const locked = await this.claim(auth, null, TABLET_SCOPES);
    if (locked) {
      return locked;
    }
    const matches = await this.matching(pin, ACTING_ROLES, IDENTIFY_CANDIDATES_MAX);
    if (matches.length === 0) {
      return PinRefusal.wrong();
    }
    if (matches.length > 1) {
      return PinRefusal.ambiguous();
    }
    await this.clear(auth, null, TABLET_SCOPES);
    await this.upgrade(matches[0].profile_id, pin, matches[0]);
    return this.openActing(auth, matches[0].profile_id);
  }

  /**
   * F4b: an active admin or cashier lifts the lock of this terminal (its
   * session counter only) before its 5 minutes. Only the
   * supervisor's own counter is claimed, so the locked terminal can ask, and
   * 5 wrong PINs lock that supervisor. Logged.
   */
  async unlockTerminal(auth: AuthContext, profileId: string, pin: string): Promise<PinRefusal | undefined> {
    if (auth.kind !== 'terminal') {
      throw new ForbiddenException(PIN_MESSAGES.terminalOnly);
    }
    const target = await this.target(profileId);
    const usable = target && target.eligible && (SUPERVISOR_ROLES as readonly string[]).includes(target.role) ? target : undefined;
    const refusal = await this.attempt(auth, profileId, ['profile'], () => this.matches(pin, usable));
    if (refusal) {
      return refusal;
    }
    await this.upgrade(profileId, pin, usable!);
    await this.clear(auth, null, TABLET_SCOPES);
    this.logger.log(`Terminal unlocked early by supervisor ${profileId}: session ${auth.sessionId}`);
    return undefined;
  }

  private async openActing(auth: AuthContext, profileId: string): Promise<ActingIdentity> {
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
   * id only that supervisor is tried (scopes session, caller, profile);
   * without, the unlocked supervisors of the restaurant, never more than they
   * are, first match wins (scopes session, caller, supervisors: neither a new
   * login nor another session resets them).
   */
  async authorize(
    auth: AuthContext,
    action: SupervisorAction,
    pin: string,
    profileId: string | undefined,
    target: { targetType: AuthorizationTarget; targetId: string },
  ): Promise<SupervisorAuthorization | PinRefusal> {
    let supervisorId: string | undefined;
    if (profileId) {
      const target = await this.target(profileId);
      const usable = target && target.eligible && (SUPERVISOR_ROLES as readonly string[]).includes(target.role) ? target : undefined;
      const refusal = await this.attempt(auth, profileId, ['session', 'caller', 'profile'], () => this.matches(pin, usable));
      if (refusal) {
        return refusal;
      }
      await this.upgrade(profileId, pin, usable!);
      supervisorId = profileId;
    } else {
      let match: Candidate | undefined;
      const refusal = await this.attempt(auth, null, ['session', 'caller', 'supervisors'], async () => {
        const candidates = await this.rows<Candidate>(sql`
          SELECT profile_id, pin_hash, pepper_version
            FROM private.supervisor_pin_candidates(${this.clock.now().toISOString()}::timestamptz)`);
        if (candidates.length === 0) {
          return this.matches(pin, undefined);
        }
        for (const candidate of candidates) {
          if (await this.matches(pin, candidate)) {
            match = candidate;
            return true;
          }
        }
        return false;
      });
      if (refusal) {
        return refusal;
      }
      await this.upgrade(match!.profile_id, pin, match!);
      supervisorId = match!.profile_id;
    }
    const [created] = await this.rows<{ id: string }>(sql`
      SELECT private.create_target_authorization(${supervisorId}::uuid, ${action}, ${this.clock.now().toISOString()}::timestamptz,
                                                 ${target.targetType}, ${target.targetId}::uuid) AS id`);
    // A row written by a function is not visible to the statement that called it: read it next.
    const [row] = await this.rows<{ id: string; expires_at: Date | string; name: string }>(sql`
      SELECT a.id, a.expires_at, p.full_name AS name
        FROM public.supervisor_authorizations a
        JOIN public.profiles p ON p.id = a.supervisor_profile_id
       WHERE a.id = ${created.id}`);
    return {
      authorizationId: row.id,
      action,
      targetType: target.targetType,
      targetId: target.targetId,
      supervisor: { id: supervisorId, name: row.name },
      expiresAt: new Date(row.expires_at).toISOString(),
    };
  }

  /** argon2id of the PIN peppered with the current version. */
  private hash(pin: string): Promise<string> {
    return this.passwords.hash(this.peppered(pin, this.current)!);
  }

  private peppered(pin: string, version: number): string | undefined {
    const pepper = this.peppers[version as PepperVersion];
    return pepper === undefined ? undefined : createHmac('sha256', pepper).update(pin).digest('hex');
  }

  /** One argon2 verify; a missing PIN (or an unknown pepper version) still pays one dummy verify. */
  private async matches(pin: string, stored: StoredPin | undefined): Promise<boolean> {
    const peppered = stored && this.peppered(pin, stored.pepper_version);
    if (!stored || peppered === undefined) {
      await this.passwords.verify(pin, undefined);
      return false;
    }
    return this.passwords.verify(peppered, { hash: stored.pin_hash, algo: 'argon2id' });
  }

  /**
   * Claim the attempt, then verify only when the claim succeeded; a correct
   * PIN clears the claimed scopes. Returns the refusal to answer, if any.
   */
  private async attempt(
    auth: AuthContext,
    profileId: string | null,
    scopes: Scope[],
    verify: () => Promise<boolean>,
  ): Promise<PinRefusal | undefined> {
    const locked = await this.claim(auth, profileId, scopes);
    if (locked) {
      return locked;
    }
    if (!(await verify())) {
      return PinRefusal.wrong();
    }
    await this.clear(auth, profileId, scopes);
    return undefined;
  }

  /** Count one attempt on the scopes; the 429 refusal while any of them is locked. */
  private async claim(auth: AuthContext, profileId: string | null, scopes: Scope[]): Promise<PinRefusal | undefined> {
    const [claim] = await this.rows<{ locked_until: Date | string | null }>(sql`
      SELECT private.claim_pin_attempt(${auth.sessionId}::uuid, ${profileId}::uuid, ${scopeArray(scopes)},
                                       ${this.clock.now().toISOString()}::timestamptz) AS locked_until`);
    return claim.locked_until === null ? undefined : PinRefusal.locked(claim.locked_until);
  }

  private async clear(auth: AuthContext, profileId: string | null, scopes: Scope[]): Promise<void> {
    await this.uow.db.execute(sql`SELECT private.clear_pin_attempts(${auth.sessionId}::uuid, ${profileId}::uuid, ${scopeArray(scopes)})`);
  }

  /**
   * Every PIN of the restaurant's active members (in `roles` unless null, at most `limit`,
   * oldest PIN first) that `pin` matches. All of them are verified, a match
   * does not stop the loop; with none, one dummy verify still runs.
   */
  private async matching(pin: string, roles: readonly string[] | null, limit: number, except?: string): Promise<Candidate[]> {
    const roleFilter = roles === null ? sql`` : sql`AND p.role IN (${sql.join(roles.map((role) => sql`${role}`), sql`, `)})`;
    const others = except === undefined ? sql`` : sql`AND sp.profile_id <> ${except}::uuid`;
    const ids = await this.rows<{ profile_id: string }>(sql`
      SELECT sp.profile_id
        FROM public.staff_pins sp
        JOIN public.profiles p ON p.id = sp.profile_id
        JOIN public.users u ON u.id = p.user_id
       WHERE p.active AND u.is_active ${roleFilter} ${others}
       ORDER BY sp.set_at, sp.profile_id
       LIMIT ${limit}`);
    const found: Candidate[] = [];
    for (const { profile_id } of ids) {
      const target = await this.target(profile_id);
      if (target?.eligible && (await this.matches(pin, target))) {
        found.push({ profile_id, pin_hash: target.pin_hash, pepper_version: target.pepper_version });
      }
    }
    if (ids.length === 0) {
      await this.matches(pin, undefined);
    }
    return found;
  }

  /**
   * Does another active member of the restaurant already have this PIN? A
   * transaction lock per restaurant serializes the check with the write that
   * follows, so two concurrent writes cannot both store the same PIN.
   */
  private async taken(profileId: string, pin: string): Promise<boolean> {
    await this.uow.db.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended('vipe.staff_pin:' || p.restaurant_id::text, 0))
        FROM public.profiles p WHERE p.id = ${profileId}::uuid`);
    return (await this.matching(pin, null, UNIQUE_PIN_CHECK_MAX, profileId)).length > 0;
  }

  /** After a correct PIN: re-hash a v1 PIN once PIN_PEPPER (v2) is configured. */
  private async upgrade(profileId: string, pin: string, stored: StoredPin): Promise<void> {
    if (stored.pepper_version < this.current) {
      const hash = await this.hash(pin);
      await this.uow.db.execute(sql`SELECT private.rehash_staff_pin(${profileId}::uuid, ${hash}, ${this.current}::smallint)`);
    }
  }

  private async target(profileId: string): Promise<PinTarget | undefined> {
    const [target] = await this.rows<PinTarget>(sql`
      SELECT pin_hash, pepper_version, role, eligible FROM private.pin_check_target(${profileId}::uuid)`);
    return target;
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

const scopeArray = (scopes: Scope[]): SQL => sql`ARRAY[${sql.join(scopes.map((scope) => sql`${scope}`), sql`, `)}]::text[]`;
