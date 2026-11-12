import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery, csvOf, dateQuery } from '../common/validation';
import { VOID_REASON_CODES, VOID_REASONS, type VoidReason } from './voids';

export const AUDIT_EVENT_TYPES = ['order_cancelled', 'items_voided', 'payment_voided'] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
/** GET /audit answers at most this many events, newest first. */
export const AUDIT_LIST_LIMIT = 500;

/** from/to are days of the restaurant's timezone, both included. */
export const auditQuerySchema = z
  .strictObject({
    from: dateQuery.optional(),
    to: dateQuery.optional(),
    type: csvOf(AUDIT_EVENT_TYPES).optional(),
    actorId: z.guid().optional(),
    authorizerId: z.guid().optional(),
    selfAuthorized: booleanQuery.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, { error: 'from must not be after to' });

export class StaffRef {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Null when the profile was removed; the name stays.' })
  id!: string | null;
  @ApiProperty() name!: string;
}

export class AuditEvent {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: AUDIT_EVENT_TYPES }) eventType!: AuditEventType;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ type: Number, nullable: true }) orderNumber!: number | null;
  @ApiProperty({ enum: ['dine_in', 'delivery', 'takeaway'], description: 'delivery: a Domicilio (cancelled from Domicilios, F3b); takeaway: a Para llevar order (S8).' }) orderType!: 'dine_in' | 'delivery' | 'takeaway';
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Only for payment_voided.' }) paymentId!: string | null;
  @ApiProperty({ type: StaffRef, description: 'Who cancelled or voided.' }) actor!: StaffRef;
  @ApiProperty({ type: StaffRef, nullable: true, description: 'The supervisor whose PIN authorized it; null when none was needed.' })
  authorizedBy!: StaffRef | null;
  @ApiProperty({ description: 'The actor authorized their own action (only with allowSelfAuthorization).' }) selfAuthorized!: boolean;
  @ApiProperty({ enum: VOID_REASON_CODES }) reason!: VoidReason;
  @ApiProperty({ description: `Spanish label of the reason: ${Object.values(VOID_REASONS).join(', ')}.` }) reasonLabel!: string;
  @ApiProperty({ type: String, nullable: true }) reasonText!: string | null;
  @ApiProperty({ description: 'Money removed: order total (a delivery: with its fee), voided lines (price x quantity) or payment total charged.' }) amount!: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'order_cancelled: previous_status, subtotal, tax, tip, total, items, sent_items (a delivery adds order_type, delivery_fee, customer_name, delivery_status, payment_mode, payments_voided); items_voided: lines; payment_voided: amounts, methods, tenders (voided by a delivery cancellation: cancellation_audit_id).',
  })
  details!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

