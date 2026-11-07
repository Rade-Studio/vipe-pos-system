import { ConflictException, ForbiddenException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { PIN_MESSAGES } from '../auth/pins';

/**
 * Cancellations and voids (odd/tasks/fase3-operacion.md, F1). Nothing is
 * deleted: public.cancel_order, public.void_order_items and public.void_payment
 * (migration 0018) store each event with its reason, actor and supervisor.
 *
 * Authorization rule: a supervisor PIN (POST /auth/authorize, F2) is required
 * to cancel an order with a live line or any payment, to void any line (every
 * line the server holds was sent to the kitchen; unsent lines live in the
 * client cart) and to void any payment. The supervisor must be someone else
 * unless the restaurant turned on allowSelfAuthorization (L14); then the event
 * is flagged selfAuthorized.
 */

/** The fixed list of reasons, code -> the Spanish label the screens show. "other" needs a text. */
export const VOID_REASONS = {
  waiter_error: 'Error del mesero',
  customer_left: 'El cliente se fue',
  dish_returned: 'Plato devuelto',
  duplicate_charge: 'Cobro duplicado',
  wrong_payment_method: 'Método de pago equivocado',
  other: 'Otro',
} as const;
export type VoidReason = keyof typeof VOID_REASONS;
export const VOID_REASON_CODES = Object.keys(VOID_REASONS) as [VoidReason, ...VoidReason[]];

export const VOID_MESSAGES = {
  reason: 'Elige un motivo de la lista',
  reasonText: 'Escribe el motivo (entre 3 y 200 caracteres)',
} as const;

const reasonText = z
  .string({ error: VOID_MESSAGES.reasonText })
  .transform((value) => value.replace(/\s+/g, ' ').trim())
  .pipe(z.union([z.literal(''), z.string().min(3, { error: VOID_MESSAGES.reasonText }).max(200, { error: VOID_MESSAGES.reasonText })]))
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

/** reason, reasonText and authorizationId: the shared body of every cancellation and void. */
export const voidReasonFields = {
  reason: z.enum(VOID_REASON_CODES, { error: VOID_MESSAGES.reason }),
  reasonText,
  /** Id from POST /auth/authorize for the matching action. */
  authorizationId: z.guid().optional(),
};

/** "other" needs a text. */
export const requireOtherText = (value: { reason: VoidReason; reasonText?: string | null }) =>
  value.reason !== 'other' || Boolean(value.reasonText);
export const OTHER_TEXT_ISSUE = { error: VOID_MESSAGES.reasonText, path: ['reasonText'] };

/**
 * The stable code of every refusal of the 0018 functions (`<function>: <code>`)
 * with its HTTP status and Spanish message. The body carries `code`.
 */
export const VOID_ERRORS: Record<string, { status: 403 | 404 | 409 | 422; message: string }> = {
  authorization_required: { status: 403, message: 'Esta acción necesita la autorización de un supervisor' },
  authorization_invalid: { status: 403, message: PIN_MESSAGES.authorization },
  self_authorization_not_allowed: { status: 403, message: 'Otra persona con rol de supervisor debe autorizar esta acción' },
  order_not_found: { status: 404, message: 'Orden no encontrada' },
  payment_not_found: { status: 404, message: 'Pago no encontrado' },
  item_not_found: { status: 422, message: 'Uno de los productos no está en la orden o ya fue anulado' },
  order_cancelled: { status: 409, message: 'La orden ya está cancelada' },
  order_paid: { status: 409, message: 'La orden ya está pagada: anula primero el pago' },
  order_closed: { status: 409, message: 'La orden está cerrada (pagada o cancelada)' },
  delivery_order: { status: 409, message: 'Los domicilios se cancelan desde el módulo de domicilios' },
  payment_voided: { status: 409, message: 'El pago ya fue anulado' },
  register_closed: { status: 409, message: 'La caja de este pago ya está cerrada; no se puede anular' },
  reason_invalid: { status: 422, message: VOID_MESSAGES.reason },
  reason_text_required: { status: 422, message: VOID_MESSAGES.reasonText },
  items_invalid: { status: 422, message: 'Revisa los productos a anular' },
  void_quantity_exceeded: { status: 422, message: 'No puedes anular más unidades de las que tiene el producto' },
  split_has_voids: { status: 409, message: 'Esta cuenta dividida tiene productos anulados; no se puede deshacer la división' },
};

const EXCEPTIONS = { 403: ForbiddenException, 404: NotFoundException, 409: ConflictException, 422: UnprocessableEntityException };
const RAISED = /^(cancel_order|void_order_items|void_payment|undo_split): ([a-z_]+)$/;

/** The mapped HttpException for a `<function>: <code>` raise of the 0018 functions, else undefined. */
export function toVoidException(error: unknown): HttpException | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const match = RAISED.exec(current.message);
    const known = match ? VOID_ERRORS[match[2]] : undefined;
    if (known && typeof (current as { code?: unknown }).code === 'string') {
      return new EXCEPTIONS[known.status]({ message: known.message, code: match![2] });
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
