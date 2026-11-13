import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { ORDER_CHANNELS } from '../catalog/catalog.dto';
import { normalizePhone } from '../delivery/phone';
import { CreateDeliveryOrderResult } from '../delivery/delivery.dto';
import { CARTA_MESSAGES } from './carta.dto';
import { CARTA_TABLE_MESSAGES, InboxOption, ProposalLineRequest, proposalSchema } from './carta-table.dto';

/** Guest and staff copy of the carta delivery (S15); 422 bodies name the field in Spanish. */
export const CARTA_DELIVERY_MESSAGES = {
  orderingDisabled: 'Este restaurante recibe los domicilios por WhatsApp.',
  tooManyPending: 'Ya tienes pedidos pendientes; el restaurante te confirmará en minutos.',
  tooBusy: 'El restaurante está recibiendo muchos pedidos; intenta en unos minutos.',
  customerInvalid: 'Revisa tus datos de contacto.',
  nameInvalid: 'Escribe tu nombre (hasta 120 caracteres).',
  phoneInvalid: 'El celular debe tener entre 7 y 15 dígitos.',
  addressInvalid: 'Escribe la dirección completa (entre 6 y 200 caracteres).',
  neighborhoodInvalid: 'El barrio admite hasta 80 caracteres.',
  paymentInvalid: 'Elige cómo pagas: efectivo, datáfono o transferencia.',
  channelInvalid: 'Elige domicilio, para llevar o en la mesa.',
  requestNotFound: 'No encontramos este pedido a domicilio.',
  requestNotConfirmed: 'Este pedido todavía no está confirmado.',
  requestAlreadyLinked: 'Este pedido ya tiene su domicilio creado.',
  deliveryOrderNotFound: 'No encontramos el domicilio creado para este pedido.',
  deliveryOrderAlreadyLinked: 'Ese domicilio ya pertenece a otro pedido de la carta.',
} as const;
const M = CARTA_DELIVERY_MESSAGES;

export const DELIVERY_PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;
export type DeliveryPaymentMethod = (typeof DELIVERY_PAYMENT_METHODS)[number];
export const DELIVERY_STAGES = ['pending', 'rejected', 'received', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'failed', 'cancelled'] as const;

/** carta_delivery_requests.tracking_token (0038): 24 base64url characters. */
export const trackingTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);

/** The proposals' line rule (private.carta_proposal_items); unknown keys are stripped. */
const itemsSchema = proposalSchema.shape.items;

/** A phone normalized with the delivery console's rule (delivery/phone.ts), or a 422. */
const phoneSchema = z
  .string()
  .max(100)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: M.phoneInvalid });
      return z.NEVER;
    }
    return normalized;
  });

/** Same bounds as private.guest_submit_delivery (0038). */
export const deliverySubmitSchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(120),
    phone: phoneSchema,
    address: z.string().trim().min(6).max(200),
    neighborhood: z.string().trim().max(80).nullable().optional(),
  }),
  items: itemsSchema,
  payment: z
    .object({
      method: z.enum(DELIVERY_PAYMENT_METHODS),
      cashFrom: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    })
    .refine((payment) => payment.cashFrom == null || payment.method === 'cash'),
  notes: z.string().trim().max(200).nullable().optional(),
});
export type DeliverySubmitInput = z.infer<typeof deliverySubmitSchema>;

export const pricingPreviewSchema = z.object({ channel: z.enum(ORDER_CHANNELS), items: itemsSchema });
export type GuestPricingInput = z.infer<typeof pricingPreviewSchema>;

/** The 422 message of each body field (customer fields by name); a bad token is the carta's one 404. */
const FIELD_MESSAGES: Record<string, string> = {
  customer: M.customerInvalid,
  'customer.name': M.nameInvalid,
  'customer.phone': M.phoneInvalid,
  'customer.address': M.addressInvalid,
  'customer.neighborhood': M.neighborhoodInvalid,
  items: CARTA_TABLE_MESSAGES.itemsInvalid,
  payment: M.paymentInvalid,
  notes: CARTA_TABLE_MESSAGES.noteInvalid,
  channel: M.channelInvalid,
  reason: CARTA_TABLE_MESSAGES.reasonInvalid,
};

/** Parse a carta delivery body: one Spanish 422 for the first wrong field. */
export function parseDeliveryInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  const [first, second] = parsed.error.issues[0]?.path ?? [];
  const field = String(first ?? '');
  const message = (field === 'customer' && second !== undefined && FIELD_MESSAGES[`customer.${String(second)}`]) || FIELD_MESSAGES[field];
  throw new UnprocessableEntityException(message ?? CARTA_TABLE_MESSAGES.itemsInvalid);
}

/** The carta's one 404 for a malformed tracking token, before any query. */
export function parseTrackingToken(token: string): string {
  if (!trackingTokenSchema.safeParse(token).success) {
    throw new NotFoundException(CARTA_MESSAGES.notFound);
  }
  return token;
}

export class DeliveryCustomerRequest {
  @ApiProperty({ minLength: 1, maxLength: 120 }) name!: string;
  @ApiProperty({ example: '300 123 4567', description: 'Normalized like the delivery console (+57 mobile prefix dropped): 7 to 15 digits.' })
  phone!: string;
  @ApiProperty({ minLength: 6, maxLength: 200 }) address!: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 80 }) neighborhood?: string | null;
}

export class DeliveryPaymentRequest {
  @ApiProperty({ enum: DELIVERY_PAYMENT_METHODS, description: 'Paid on delivery: Efectivo, Datáfono or Transferencia.' }) method!: DeliveryPaymentMethod;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, description: '"¿Con cuánto pagas?" (cash only).' }) cashFrom?: number | null;
}

export class DeliverySubmitRequest {
  @ApiProperty({ type: DeliveryCustomerRequest }) customer!: DeliveryCustomerRequest;
  @ApiProperty({ type: [ProposalLineRequest], minItems: 1, maxItems: 20 }) items!: ProposalLineRequest[];
  @ApiProperty({ type: DeliveryPaymentRequest }) payment!: DeliveryPaymentRequest;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) notes?: string | null;
}

export class DeliverySubmitted {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ description: 'Follow the order with GET /carta/:slug/delivery/:trackingToken (24 base64url characters).' }) trackingToken!: string;
  @ApiProperty({ example: 'pending' }) status!: string;
  @ApiProperty() createdAt!: string;
}

export class GuestDeliveryLine {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() quantity!: number;
}

export class GuestDeliveryStatus {
  @ApiProperty({ enum: ['pending', 'confirmed', 'rejected'] }) status!: string;
  @ApiProperty({ enum: DELIVERY_STAGES, description: 'Recibido, Confirmado, En camino, Entregado: the delivery order\'s status once confirmed.' })
  stage!: string;
  @ApiProperty({ type: String, nullable: true }) rejectReason!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: [GuestDeliveryLine] }) lines!: GuestDeliveryLine[];
  @ApiProperty({ description: 'The delivery fee shown when sending.' }) deliveryFee!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Null until the delivery order exists; then its total plus the delivery fee.' })
  total!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 142, description: '"Pedido D-0142": the delivery order\'s number once it exists.' })
  orderNumber!: number | null;
  @ApiProperty({ enum: DELIVERY_PAYMENT_METHODS }) paymentMethod!: string;
}

export class GuestPricingRequest {
  @ApiProperty({ enum: ORDER_CHANNELS }) channel!: string;
  @ApiProperty({ type: [ProposalLineRequest], minItems: 1, maxItems: 20 }) items!: ProposalLineRequest[];
}

export class GuestPricingDiscount {
  @ApiProperty({ enum: ['promotion_item', 'combo', 'promotion_bill'] }) kind!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) promotionId!: string | null;
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

export class GuestPricingLine {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty({ description: 'Unit list price, options included.' }) unitPrice!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) promotionId!: string | null;
  @ApiProperty({ type: String, nullable: true }) promotionName!: string | null;
  @ApiProperty({ type: [GuestPricingDiscount] }) discounts!: GuestPricingDiscount[];
}

export class GuestPricing {
  @ApiProperty({ enum: ORDER_CHANNELS }) channel!: string;
  @ApiProperty({ type: [GuestPricingLine], description: 'In the order sent; same values as POST /orders/pricing-preview draft lines.' })
  lines!: GuestPricingLine[];
  @ApiProperty({ type: GuestPricingDiscount, nullable: true }) billDiscount!: GuestPricingDiscount | null;
  @ApiProperty() grossSubtotal!: number;
  @ApiProperty() totalDiscounts!: number;
  @ApiProperty() netSubtotal!: number;
  @ApiProperty({ example: 8, description: 'The tax percentage the guest total includes: only delivery adds tax, read as create_delivery_order (missing 0, an unusable value 0); dine_in and takeaway are always 0 (their total stays the net subtotal).' }) taxPercentage!: number;
  @ApiProperty({ description: 'round(netSubtotal x taxPercentage / 100), as the bill; no tax on the delivery fee.' }) tax!: number;
  @ApiProperty({ description: 'The carta\'s delivery fee on delivery, else 0.' }) deliveryFee!: number;
  @ApiProperty({ description: 'netSubtotal + tax + deliveryFee: the amount due, without a tip.' }) total!: number;
}

export class DeliveryInboxLine {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: [InboxOption] }) options!: InboxOption[];
}

export class DeliveryInboxRequest {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() customerName!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The name already registered for this phone (null when new). Confirming keeps it; the carta name goes to the delivery notes.',
  })
  registeredName!: string | null;
  @ApiProperty() phone!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ type: String, nullable: true }) neighborhood!: string | null;
  @ApiProperty({ type: String, nullable: true }) notes!: string | null;
  @ApiProperty({ enum: DELIVERY_PAYMENT_METHODS }) paymentMethod!: string;
  @ApiProperty({ type: Number, nullable: true }) cashFrom!: number | null;
  @ApiProperty() deliveryFee!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: [DeliveryInboxLine] }) lines!: DeliveryInboxLine[];
  @ApiProperty({ type: Number, nullable: true, description: 'netSubtotal of POST /orders/pricing-preview on delivery now; null when a line no longer prices.' })
  previewSubtotal!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'round(previewSubtotal x the delivery order\'s tax percentage / 100), as the guest preview; null with previewSubtotal.',
  })
  previewTax!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'previewSubtotal + previewTax + deliveryFee: the total the guest saw.' }) previewTotal!: number | null;
}

export class DeliveryRequestConfirmed {
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty({ example: 'confirmed' }) status!: string;
  @ApiProperty({ type: CreateDeliveryOrderResult, description: 'POST /delivery/orders\' answer for the order created on confirm.' })
  order!: CreateDeliveryOrderResult;
}
