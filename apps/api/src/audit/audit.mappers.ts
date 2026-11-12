import { toIso } from '../common/validation';
import type { AuditEvent, AuditEventType, StaffRef } from './audit.dto';
import { VOID_REASONS, type VoidReason } from './voids';

type Json = Record<string, unknown>;

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
/** numeric columns arrive as JSON numbers through to_jsonb. */
const num = (value: unknown) => Number(value ?? 0);

export const staffRef = (id: unknown, name: unknown): StaffRef => ({ id: text(id), name: String(name) });
export const authorizer = (id: unknown, name: unknown): StaffRef | null => (name === null || name === undefined ? null : staffRef(id, name));
export const reasonOf = (row: Json) => {
  const reason = row.reason_code as VoidReason;
  return { reason, reasonLabel: VOID_REASONS[reason], reasonText: text(row.reason_text) };
};

/** One public.audit_log row (to_jsonb) as the API event. */
export const toAuditEvent = (row: Json): AuditEvent => {
  const details = (row.details as Json | null) ?? {};
  return {
    id: String(row.id),
    eventType: row.event_type as AuditEventType,
    orderId: String(row.order_id),
    orderNumber: details.order_number === undefined || details.order_number === null ? null : num(details.order_number),
    orderType: row.order_type === 'delivery' || row.order_type === 'takeaway' ? row.order_type : 'dine_in',
    paymentId: text(row.payment_id),
    actor: staffRef(row.actor_profile_id, row.actor_name),
    authorizedBy: authorizer(row.authorized_by_profile_id, row.authorized_by_name),
    selfAuthorized: row.self_authorized === true,
    ...reasonOf(row),
    amount: num(row.amount),
    details,
    createdAt: toIso(String(row.created_at)),
  };
};
