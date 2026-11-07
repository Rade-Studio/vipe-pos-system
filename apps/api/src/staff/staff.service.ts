import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { PasswordsService } from '../auth/passwords.service';
import { UnitOfWork } from '../db/unit-of-work';
import { SUPERVISOR_ROLES } from '../auth/pins';
import { type createStaffSchema, STAFF_MESSAGES, type StaffMember, type StaffSupervisor, type updateStaffSchema } from './staff.dto';

interface StaffRow {
  id: string;
  user_id: string | null;
  full_name: string;
  username: string | null;
  email: string | null;
  role: string;
  active: boolean;
  created_at: Date | string;
  has_pin: boolean;
  pin_locked_until: Date | string | null;
}

const toStaffMember = (row: StaffRow): StaffMember => ({
  id: row.id,
  userId: row.user_id,
  fullName: row.full_name,
  username: row.username,
  email: row.email,
  role: row.role,
  active: row.active,
  createdAt: new Date(row.created_at).toISOString(),
  hasPin: row.has_pin,
  pinLockedUntil: row.pin_locked_until === null ? null : new Date(row.pin_locked_until).toISOString(),
});

/**
 * Staff accounts (T12). Reads go through RLS (profiles and users of the
 * caller's restaurant); every write goes through the private.*_staff_*
 * SECURITY DEFINER helpers of migration 0011, which check inside the function
 * that the caller is an active admin, that the target is in the same
 * restaurant, is not an admin and is not the caller, and the role allow-list.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly passwords: PasswordsService,
  ) {}

  async list(): Promise<StaffMember[]> {
    return (await this.select(sql`ORDER BY p.full_name, p.id`)).map(toStaffMember);
  }

  /**
   * Active admins and cashiers (SUPERVISOR_ROLES) of the caller's restaurant,
   * by name: who can close a shared terminal or authorize a void. The lock
   * end comes from private.staff_pin_locks, which only an admin may run (it
   * raises otherwise and would abort the request), so other callers get null.
   */
  async supervisors(callerRole: string): Promise<StaffSupervisor[]> {
    const roles = sql.join(SUPERVISOR_ROLES.map((role) => sql`${role}`), sql`, `);
    const locks =
      callerRole === 'admin'
        ? sql`LEFT JOIN private.staff_pin_locks(now()) l ON l.profile_id = p.id`
        : sql`LEFT JOIN (SELECT NULL::uuid AS profile_id, NULL::timestamptz AS locked_until) l ON false`;
    const rows = await this.rows<{ id: string; full_name: string; role: string; has_pin: boolean; locked_until: Date | string | null }>(sql`
      SELECT p.id, p.full_name, p.role, sp.profile_id IS NOT NULL AS has_pin, l.locked_until
        FROM public.profiles p
        JOIN public.users u ON u.id = p.user_id
        LEFT JOIN public.staff_pins sp ON sp.profile_id = p.id
        ${locks}
       WHERE p.active AND u.is_active AND p.role IN (${roles})
       ORDER BY p.full_name, p.id`);
    return rows.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      role: row.role,
      hasPin: row.has_pin,
      pinLockedUntil: row.locked_until === null ? null : new Date(row.locked_until).toISOString(),
    }));
  }

  async create(input: z.infer<typeof createStaffSchema>): Promise<StaffMember> {
    const hash = await this.passwords.hash(input.password);
    try {
      const [row] = await this.rows<{ id: string }>(sql`
        SELECT private.create_staff_user(${input.email}, ${hash}, 'argon2id', ${input.fullName},
                                         ${input.username ?? null}, ${input.role}, ${input.active ?? true}) AS id`);
      return await this.get(row.id);
    } catch (error) {
      throw conflictOf(error);
    }
  }

  /** Absent fields keep their value; a null or blank username clears it. */
  async update(id: string, input: z.infer<typeof updateStaffSchema>): Promise<StaffMember> {
    const username = input.username === undefined ? null : (input.username ?? '');
    try {
      await this.uow.db.execute(sql`
        SELECT private.update_staff_profile(${id}, ${input.fullName ?? null}, ${username},
                                            ${input.active ?? null}, ${input.role ?? null})`);
    } catch (error) {
      throw conflictOf(error);
    }
    return this.get(id);
  }

  /** Also revokes the member's open sessions (inside the helper). */
  async setPassword(id: string, password: string): Promise<void> {
    const hash = await this.passwords.hash(password);
    await this.uow.db.execute(sql`SELECT private.set_staff_password(${id}, ${hash}, 'argon2id')`);
  }

  /** Deletes the login; the profile and sessions cascade. */
  async remove(id: string): Promise<void> {
    await this.uow.db.execute(sql`SELECT private.delete_staff_user(${id})`);
  }

  private async get(id: string): Promise<StaffMember> {
    const [row] = await this.select(sql`WHERE p.id = ${id}`);
    if (!row) {
      throw new NotFoundException('Staff member not found');
    }
    return toStaffMember(row);
  }

  private select(tail: SQL): Promise<StaffRow[]> {
    return this.rows<StaffRow>(sql`
      SELECT p.id, p.user_id, p.full_name, p.username, coalesce(u.email::text, p.email) AS email,
             p.role, p.active, p.created_at, sp.profile_id IS NOT NULL AS has_pin,
             l.locked_until AS pin_locked_until
        FROM public.profiles p
        LEFT JOIN public.users u ON u.id = p.user_id
        LEFT JOIN public.staff_pins sp ON sp.profile_id = p.id
        LEFT JOIN private.staff_pin_locks(now()) l ON l.profile_id = p.id
       ${tail}`);
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

/** Duplicate email or username as the Spanish 409 the staff form shows; anything else unchanged. */
function conflictOf(error: unknown): unknown {
  if (violates(error, 'users_email_key')) {
    return new ConflictException(STAFF_MESSAGES.duplicate);
  }
  if (violates(error, 'profiles_username_key')) {
    return new ConflictException(STAFF_MESSAGES.duplicateUsername);
  }
  return error;
}

/** A unique violation of `constraint`; Drizzle wraps the `pg` error as `cause`. */
function violates(error: unknown, constraint: string): boolean {
  for (let current = error, depth = 0; depth < 5 && current instanceof Error; depth++) {
    const pg = current as { code?: unknown; constraint?: unknown };
    if (pg.code === '23505') {
      return pg.constraint === constraint;
    }
    current = current.cause;
  }
  return false;
}
