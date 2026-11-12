import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { CARTA_MESSAGES } from './carta.dto';

/** Guest and staff copy of the table QR flow (S12–S14); 422 bodies name the field in Spanish. */
export const CARTA_TABLE_MESSAGES = {
  orderingDisabled: 'Este restaurante toma los pedidos en la mesa.',
  tableNotOpen: 'Para pedir desde aquí, la mesa debe estar abierta',
  dishUnavailable: 'Uno de los platos se acabó por hoy.',
  optionsInvalid: 'Revisa las opciones elegidas para el plato.',
  itemsInvalid: 'Revisa los platos del pedido: entre 1 y 20 líneas de 1 a 20 unidades.',
  noteInvalid: 'La nota del pedido admite hasta 200 caracteres.',
  guestKeyInvalid: 'El identificador del comensal no es válido.',
  kindInvalid: 'Solo puedes pedir la cuenta o llamar al mesero.',
  ratingInvalid: 'La calificación va de 1 a 5 estrellas.',
  commentInvalid: 'El comentario admite hasta 500 caracteres.',
  reasonInvalid: 'El motivo admite hasta 140 caracteres.',
  tooManyPending: 'Ya enviaste varios pedidos; espera a que el mesero los revise.',
  roleNotAllowed: 'Tu rol no atiende los pedidos de la carta.',
  proposalNotFound: 'No encontramos este pedido.',
  requestNotFound: 'No encontramos esta solicitud.',
  proposalNotPending: 'Este pedido ya fue confirmado o rechazado.',
  orderNotOpen: 'La mesa ya no tiene una cuenta abierta.',
  proposalNotConfirmed: 'Este pedido todavía no está confirmado.',
  proposalAlreadyLinked: 'Los platos de este pedido ya están en la cuenta.',
  itemNotInOrder: 'Un plato no pertenece a la cuenta de la mesa.',
} as const;

/** carta_table_proposals.guest_key (0036). */
export const guestKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const TABLE_REQUEST_KINDS = ['bill', 'waiter'] as const;

/** Same bounds as private.carta_proposal_items (0036); unknown keys are stripped. */
export const proposalSchema = z.object({
  guestKey: guestKeySchema,
  items: z
    .array(
      z.object({
        dishId: z.guid(),
        quantity: z.number().int().min(1).max(20),
        optionIds: z.array(z.guid()).max(50).optional(),
        note: z.string().trim().max(140).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
  note: z.string().trim().max(200).nullable().optional(),
});
export const tableRequestSchema = z.object({ kind: z.enum(TABLE_REQUEST_KINDS) });
export const feedbackSchema = z.object({
  token: z.string().max(64).optional(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).nullable().optional(),
});
export const statusQuerySchema = z.object({ guestKey: guestKeySchema });
export const rejectSchema = z.object({ reason: z.string().trim().max(140).nullable().optional() });

/** The 422 message of each guest body field; a bad token is the carta's one 404. */
const FIELD_MESSAGES: Record<string, string> = {
  guestKey: CARTA_TABLE_MESSAGES.guestKeyInvalid,
  items: CARTA_TABLE_MESSAGES.itemsInvalid,
  note: CARTA_TABLE_MESSAGES.noteInvalid,
  kind: CARTA_TABLE_MESSAGES.kindInvalid,
  rating: CARTA_TABLE_MESSAGES.ratingInvalid,
  comment: CARTA_TABLE_MESSAGES.commentInvalid,
  reason: CARTA_TABLE_MESSAGES.reasonInvalid,
};

/** Parse a carta table body or query: one Spanish 422 for the first wrong field. */
export function parseCartaInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  const field = String(parsed.error.issues[0]?.path[0] ?? '');
  if (field === 'token') {
    throw new NotFoundException(CARTA_MESSAGES.notFound);
  }
  throw new UnprocessableEntityException(FIELD_MESSAGES[field] ?? CARTA_TABLE_MESSAGES.itemsInvalid);
}

export class ProposalLineRequest {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ minimum: 1, maximum: 20 }) quantity!: number;
  @ApiPropertyOptional({ type: [String], description: 'Chosen modifier option ids (distinct, <= 50).' }) optionIds?: string[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 140 }) note?: string | null;
}

export class ProposalRequest {
  @ApiProperty({ example: 'k3J9xZ0qLmN4pQ7r', description: 'Opaque per-browser id, 16-64 of [A-Za-z0-9_-].' }) guestKey!: string;
  @ApiProperty({ type: [ProposalLineRequest], minItems: 1, maxItems: 20 }) items!: ProposalLineRequest[];
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 }) note?: string | null;
}

export class ProposalCreated {
  @ApiProperty({ format: 'uuid' }) proposalId!: string;
  @ApiProperty({ example: 'pending' }) status!: string;
  @ApiProperty() createdAt!: string;
}

export class GuestProposalLine {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() quantity!: number;
}

export class GuestProposal {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: ['pending', 'confirmed', 'rejected'] }) status!: string;
  @ApiProperty({ enum: ['pending', 'rejected', 'confirmed', 'kitchen', 'served', 'cancelled'], description: 'Enviado, Confirmado, En la cocina, Servido.' })
  stage!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: String, nullable: true }) decidedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectReason!: string | null;
  @ApiProperty({ type: [GuestProposalLine] }) lines!: GuestProposalLine[];
}

export class GuestTableStatus {
  @ApiProperty({ description: 'The table has an open order.' }) isOpen!: boolean;
  @ApiProperty({ type: String, nullable: true, example: 'Carolina' }) waiterFirstName!: string | null;
  @ApiProperty() tableOrderingEnabled!: boolean;
  @ApiProperty() showTableBill!: boolean;
  @ApiProperty({ type: [GuestProposal], description: "Only this guest key's, for the current open order, oldest first." }) proposals!: GuestProposal[];
  @ApiProperty({ enum: TABLE_REQUEST_KINDS, isArray: true, description: 'Unresolved requests of the open order.' }) requests!: string[];
}

export class GuestBillLine {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() unitPrice!: number;
  @ApiProperty() lineTotal!: number;
}

export class GuestBillDiscount {
  @ApiProperty() label!: string;
  @ApiProperty() amount!: number;
}

export class GuestTableBill {
  @ApiProperty({ type: [GuestBillLine] }) lines!: GuestBillLine[];
  @ApiProperty({ type: [GuestBillDiscount] }) discounts!: GuestBillDiscount[];
  @ApiProperty() grossSubtotal!: number;
  @ApiProperty() totalDiscounts!: number;
  @ApiProperty() subtotal!: number;
  @ApiProperty({ example: 10, description: 'Suggested tip (voluntary).' }) tipPercentage!: number;
  @ApiProperty() updatedAt!: string;
}

export class TableRequestRequest {
  @ApiProperty({ enum: TABLE_REQUEST_KINDS }) kind!: string;
}

export class TableRequestCreated {
  @ApiProperty({ enum: TABLE_REQUEST_KINDS }) kind!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ description: 'An unresolved request of this kind already existed; nothing new was stored.' }) alreadyPending!: boolean;
}

export class FeedbackRequest {
  @ApiPropertyOptional({ description: 'Table QR token, when left from a table.' }) token?: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500, description: 'Private comment for the restaurant.' })
  comment?: string | null;
}

export class InboxOption {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
}

export class InboxProposalLine {
  @ApiProperty({ format: 'uuid' }) dishId!: string;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty() quantity!: number;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: [InboxOption] }) options!: InboxOption[];
}

export class InboxProposal {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() tableNumber!: number;
  @ApiProperty({ type: String, nullable: true }) zoneName!: string | null;
  @ApiProperty({ type: String, nullable: true }) waiterName!: string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ type: [InboxProposalLine] }) lines!: InboxProposalLine[];
}

export class InboxRequest {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: TABLE_REQUEST_KINDS }) kind!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty() tableNumber!: number;
  @ApiProperty({ type: String, nullable: true }) zoneName!: string | null;
  @ApiProperty({ type: String, nullable: true }) waiterName!: string | null;
  @ApiProperty() createdAt!: string;
}

export class CartaInbox {
  @ApiProperty({ type: [InboxProposal], description: 'Pending proposals of open orders, newest first.' }) proposals!: InboxProposal[];
  @ApiProperty({ type: [InboxRequest], description: 'Unresolved requests of open orders, newest first.' }) requests!: InboxRequest[];
}

export class RejectProposalRequest {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 140, description: 'Shown to the guest.' }) reason?: string | null;
}

export class ProposalConfirmed {
  @ApiProperty({ format: 'uuid' }) proposalId!: string;
  @ApiProperty({ format: 'uuid' }) orderId!: string;
  @ApiProperty({ example: 'confirmed' }) status!: string;
  @ApiProperty({ example: 'kitchen', description: 'The stage the guest now sees.' }) stage!: string;
  @ApiProperty({ type: [String], description: 'The order_items added for the proposal.' }) orderItemIds!: string[];
}
