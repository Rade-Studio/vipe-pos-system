import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const PRINT_JOB_KINDS = ['invoice', 'command'] as const;
export type PrintJobKind = (typeof PRINT_JOB_KINDS)[number];

/** Free-form JSON object; the printing service reads the fields it knows (pos/print_renderer.py). */
const jsonObject = z.looseObject({});
/** Non-blank text, stored exactly as sent (no trimming). */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, 'Must not be blank');
const MAX_LINES = 500;

/**
 * `PrintableInvoice` and its display lines, stored as the former `new_invoice`
 * broadcast payload `{invoiceNumber, invoice, displayItems}`.
 */
export const invoicePrintSchema = z.strictObject({
  invoice: z.looseObject({ invoiceNumber: text(100) }),
  displayItems: z.array(jsonObject).max(MAX_LINES),
});

/**
 * `CommandPayload` without `invoiceNumber`: the job id takes its place, so the
 * stored payload is the former `new_command` broadcast. `orderId` names the
 * order the comanda belongs to: the API fills `waiter` (the acting profile)
 * and `orderNumber` from it, so a sent `waiter` is accepted and ignored.
 */
export const commandPrintSchema = z.strictObject({
  orderId: z.guid(),
  items: z.array(jsonObject).min(1).max(MAX_LINES),
  waiter: z.string().max(200).optional(),
  table: z.number().nullable().optional(),
  delivery: jsonObject.optional(),
});

/** The stored command fields (PrintService.printCommand), filled by the server. */
export interface CommandJobInput {
  items: Record<string, unknown>[];
  waiter: string;
  orderNumber: number;
  table?: number | null;
  delivery?: Record<string, unknown>;
}

export const pendingQuerySchema = z.strictObject({ after: z.guid().optional() });

export const createPrinterSchema = z.strictObject({ name: z.string().trim().min(1).max(100) });

export class InvoicePrintRequest {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'PrintableInvoice (types/index.ts); invoiceNumber is required.',
  })
  invoice!: Record<string, unknown>;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    maxItems: MAX_LINES,
    description: 'Lines {name, quantity, price, comments?, modifiers?}: price is the unit price with the options (F7); modifiers [{group, name, price}].',
  })
  displayItems!: Record<string, unknown>[];
}

export class CommandPrintRequest {
  @ApiProperty({ format: 'uuid', description: "The order of the caller's restaurant this comanda belongs to (404 otherwise)." })
  orderId!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    minItems: 1,
    maxItems: MAX_LINES,
    description: 'Lines {name, quantity, comments?, modifiers?, dishId?}; modifiers [{group, name, price}] (F7), left out without options.',
  })
  items!: Record<string, unknown>[];

  @ApiPropertyOptional({ deprecated: true, description: "Ignored: the API prints the sender's profile name." })
  waiter?: string;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Null or absent for delivery orders; the order's table wins." })
  table?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'DeliveryPrintInfo (types/index.ts).' })
  delivery?: Record<string, unknown>;
}

export class PrintJobCreated {
  @ApiProperty({ format: 'uuid', description: 'Also the invoiceNumber of a command payload.' }) id!: string;
  @ApiProperty({ enum: PRINT_JOB_KINDS }) kind!: PrintJobKind;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

/** POST /print/commands when the restaurant has stations (F6): the first job, plus one job per station. */
export class PrintJobsCreated extends PrintJobCreated {
  @ApiProperty({ type: [PrintJobCreated], description: 'One comanda per station, in station order.' }) jobs!: PrintJobCreated[];
}

/** Body of the `print_job` socket event, plus createdAt in GET /print/jobs/pending. */
export class PendingPrintJob {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: PRINT_JOB_KINDS }) kind!: PrintJobKind;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'invoice: {invoiceNumber, invoice, displayItems, station?}; command: {invoiceNumber (job id), orderNumber?, items, waiter, table?, delivery?, station?}. Lines may carry modifiers [{group, name, price}] (F7; invoice line prices include them); readers ignore keys they do not know. station {id, name} only when the restaurant has stations (F6): one command per station with its lines, Caja on invoices.',
  })
  payload!: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreatePrinterRequest {
  @ApiProperty({ minLength: 1, maxLength: 100 }) name!: string;
}

export class PrinterDevice {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) revokedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSeenAt!: string | null;
}

export class CreatedPrinterDevice extends PrinterDevice {
  @ApiProperty({ description: 'Plaintext token (VIPE_PRINTER_TOKEN). Shown only in this response.' }) token!: string;
}
