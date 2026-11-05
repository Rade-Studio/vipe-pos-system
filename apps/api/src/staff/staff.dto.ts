import { UnprocessableEntityException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/** Roles an admin can give; admins are never created or promoted through the API. */
export const STAFF_ROLES = ['waiter', 'kitchen', 'cashier', 'delivery_operator'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Every role a listed profile can have. */
export const PROFILE_ROLES = ['admin', ...STAFF_ROLES] as const;

/**
 * Spanish messages of the create-staff-account Edge Function
 * (supabase/functions/create-staff-account/{validate,handler}.ts), which the
 * staff form shows verbatim.
 */
export const STAFF_MESSAGES = {
  invalid: 'Solicitud inválida',
  email: 'El correo electrónico no es válido',
  password: 'La contraseña debe tener al menos 8 caracteres',
  weakPassword: 'La contraseña no cumple los requisitos de seguridad',
  fullName: 'El nombre debe tener entre 1 y 100 caracteres',
  role: 'El rol no es válido',
  username: 'El nombre de usuario debe tener como máximo 50 caracteres',
  duplicate: 'Ya existe una cuenta con ese correo electrónico',
  /** Not in the Edge Function (it never set usernames); same style. */
  duplicateUsername: 'Ya existe un integrante con ese nombre de usuario',
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** argon2 hashes any length; the cap only bounds the work per request. */
const MAX_PASSWORD = 128;

const email = z
  .string({ error: STAFF_MESSAGES.email })
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().max(100, STAFF_MESSAGES.email).regex(EMAIL_RE, STAFF_MESSAGES.email));
const password = z
  .string({ error: STAFF_MESSAGES.password })
  .min(8, STAFF_MESSAGES.password)
  .max(MAX_PASSWORD, STAFF_MESSAGES.weakPassword);
const fullName = z
  .string({ error: STAFF_MESSAGES.fullName })
  .transform((value) => value.trim())
  .pipe(z.string().min(1, STAFF_MESSAGES.fullName).max(100, STAFF_MESSAGES.fullName));
/** Blank or null clears the username. */
const username = z
  .string({ error: STAFF_MESSAGES.username })
  .transform((value) => value.trim())
  .pipe(z.string().max(50, STAFF_MESSAGES.username))
  .nullable();
const role = z.enum(STAFF_ROLES, { error: STAFF_MESSAGES.role });
const active = z.boolean({ error: STAFF_MESSAGES.invalid });

const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape, { error: STAFF_MESSAGES.invalid });

export const createStaffSchema = strict({
  email,
  password,
  fullName,
  role,
  username: username.optional(),
  active: active.optional(),
});

export const updateStaffSchema = strict({
  fullName: fullName.optional(),
  username: username.optional(),
  active: active.optional(),
  role: role.optional(),
});

export const setStaffPasswordSchema = strict({ password });

/**
 * Like `parseInput`, but the 422 message is the first issue's Spanish text
 * alone (no field path), as the Edge Function answered.
 */
export function parseStaffInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const message = issue.code === 'unrecognized_keys' || issue.path.length === 0 ? STAFF_MESSAGES.invalid : issue.message;
    throw new UnprocessableEntityException(message);
  }
  return parsed.data;
}

export class StaffMember {
  @ApiProperty({ format: 'uuid', description: 'Profile id (the :id of the staff routes).' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Login identity; null for a legacy profile without login.' })
  userId!: string | null;
  @ApiProperty() fullName!: string;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Login email (profile email for a legacy profile).' })
  email!: string | null;
  @ApiProperty({ enum: PROFILE_ROLES }) role!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreateStaffRequest {
  @ApiProperty({ format: 'email', maxLength: 100, description: 'Trimmed and lower-cased; unique (409).' }) email!: string;
  @ApiProperty({ minLength: 8, maxLength: MAX_PASSWORD }) password!: string;
  @ApiProperty({ minLength: 1, maxLength: 100 }) fullName!: string;
  @ApiProperty({ enum: STAFF_ROLES }) role!: StaffRole;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 }) username?: string | null;
  @ApiPropertyOptional({ default: true }) active?: boolean;
}

export class UpdateStaffRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 }) fullName?: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50, description: 'Null or blank clears it.' })
  username?: string | null;
  @ApiPropertyOptional() active?: boolean;
  @ApiPropertyOptional({ enum: STAFF_ROLES }) role?: StaffRole;
}

export class SetStaffPasswordRequest {
  @ApiProperty({ minLength: 8, maxLength: MAX_PASSWORD }) password!: string;
}
