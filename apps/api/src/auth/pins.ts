import { UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Staff PINs, shared terminals and supervisor authorization
 * (odd/tasks/fase3-operacion.md, F2). The numbers below are the documented
 * policy; the lockout numbers are also hard-coded in private.claim_pin_attempt
 * (0017) and the authorization TTL in private.create_supervisor_authorization.
 */

/**
 * 5 attempts within 15 minutes lock every scope they claimed (session,
 * caller, profile or the restaurant's supervisor set) for PIN_LOCK_MS.
 */
export const PIN_MAX_FAILURES = 5;
/** Lockout length after PIN_MAX_FAILURES. */
export const PIN_LOCK_MS = 5 * 60_000;
/** Lifetime of the acting-staff claim a terminal gets from POST /auth/identify. */
export const ACTING_TTL_MS = 5 * 60_000;
/** Lifetime of a supervisor authorization (single use). */
export const AUTHORIZATION_TTL_MS = 2 * 60_000;

/** Roles whose PIN authorizes cancellations and voids (same list in 0017). */
export const SUPERVISOR_ROLES = ['admin', 'cashier'] as const;
/** Roles that may open a shared terminal (same list in 0017). */
export const TERMINAL_OPENER_ROLES = ['admin', 'cashier'] as const;
/** Roles that may identify on a terminal to take orders (same list in 0017). */
export const ACTING_ROLES = ['admin', 'cashier', 'waiter'] as const;

/** Actions a supervisor authorization can be bound to; F1 requires one per cancellation or void. */
export const SUPERVISOR_ACTIONS = ['cancel_order', 'void_item', 'void_payment'] as const;
export type SupervisorAction = (typeof SUPERVISOR_ACTIONS)[number];

export const PIN_MESSAGES = {
  invalid: 'Solicitud inválida',
  format: 'El PIN debe tener entre 4 y 6 dígitos',
  weak: 'El PIN es muy fácil de adivinar: no uses el mismo dígito, números consecutivos ni patrones repetidos',
  wrong: 'PIN incorrecto',
  locked: 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo',
  noPin: 'Aún no tienes un PIN; pídele al administrador que te asigne uno',
  action: 'La acción no es válida',
  profile: 'El integrante no es válido',
  terminalOnly: 'Esta acción solo está disponible en una terminal compartida',
  terminalRoute: 'Esta terminal no puede acceder a esta sección',
  actingRequired: 'Identifícate con tu PIN para registrar el pedido',
  opener: 'Solo un administrador o cajero puede abrir una terminal compartida',
  authorization: 'La autorización del supervisor no es válida, expiró o ya fue usada',
  target: 'Indica la orden o el pago que se va a anular',
} as const;

/** What an authorization is for (F1): an order for cancel_order and void_item, a payment for void_payment. */
export const AUTHORIZATION_TARGETS = ['order', 'payment'] as const;
export type AuthorizationTarget = (typeof AUTHORIZATION_TARGETS)[number];
export const targetTypeOf = (action: SupervisorAction): AuthorizationTarget => (action === 'void_payment' ? 'payment' : 'order');

/**
 * Easy to guess: one repeated digit (1111), a run up or down where 9 wraps
 * to 0 (1234, 4321, 7890) or a repeated block (1212, 456456).
 */
export function isWeakPin(pin: string): boolean {
  const digits = [...pin].map(Number);
  const step = (digits[1] - digits[0] + 10) % 10;
  const run = digits.every((digit, i) => i === 0 || (digit - digits[i - 1] + 10) % 10 === step);
  if (run && (step === 0 || step === 1 || step === 9)) {
    return true;
  }
  for (let size = 1; size <= pin.length / 2; size++) {
    if (pin.length % size === 0 && pin.slice(0, size).repeat(pin.length / size) === pin) {
      return true;
    }
  }
  return false;
}

const pinFormat = z.string({ error: PIN_MESSAGES.format }).regex(/^\d{4,6}$/, PIN_MESSAGES.format);
/** A new PIN: 4-6 digits and not weak. */
const newPin = pinFormat.refine((pin) => !isWeakPin(pin), PIN_MESSAGES.weak);
/** A PIN being checked: any 4-6 digits (a weak legacy value still fails as a wrong PIN). */
const enteredPin = pinFormat;
const strict = <T extends z.ZodRawShape>(shape: T) => z.strictObject(shape, { error: PIN_MESSAGES.invalid });

export const setPinSchema = strict({ pin: newPin });
export const changeOwnPinSchema = strict({ currentPin: enteredPin, pin: newPin });
export const identifySchema = strict({ profileId: z.guid({ error: PIN_MESSAGES.profile }), pin: enteredPin });
export const authorizeSchema = strict({
  pin: enteredPin,
  action: z.enum(SUPERVISOR_ACTIONS, { error: PIN_MESSAGES.action }),
  profileId: z.guid({ error: PIN_MESSAGES.profile }).optional(),
  targetType: z.enum(AUTHORIZATION_TARGETS, { error: PIN_MESSAGES.target }),
  targetId: z.guid({ error: PIN_MESSAGES.target }),
}).refine((input) => input.targetType === targetTypeOf(input.action), { error: PIN_MESSAGES.target, path: ['targetType'] });

/** 422 with the first issue's Spanish text alone, as the staff forms expect. */
export function parsePinInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const message = issue.code === 'unrecognized_keys' || issue.path.length === 0 ? PIN_MESSAGES.invalid : issue.message;
    throw new UnprocessableEntityException(message);
  }
  return parsed.data;
}
