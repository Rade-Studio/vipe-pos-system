import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { RegisterSummary } from '../registers/registers.dto';

export const PRINT_JOB_KINDS = ['invoice', 'command', 'x_report'] as const;
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

const whole = z.number().int();
const isoDateTime = z.iso.datetime({ offset: true });

/**
 * "Informe X" (informe-x-termico S1): GET /registers/summary exactly as it
 * answered (the printers read the fields below; any other key is kept), the
 * business header, the cashier, the shift's opening and the print time as
 * ISO date-times in the cashier's wall time (printed as written), and the
 * configured tax. Printers render it like components/printing/XReportSlip.
 */
export const xReportPrintSchema = z.strictObject({
  business: z.strictObject({ name: z.string().max(200), nit: z.string().max(100), address: z.string().max(300) }),
  cashierName: z.string().max(200).nullable(),
  openedAt: isoDateTime,
  printedAt: isoDateTime,
  summary: z.looseObject({
    initialCash: whole,
    paymentsCount: whole,
    totalSales: whole,
    totalTips: whole,
    totalChange: whole,
    cashDeposits: whole,
    cashWithdrawals: whole,
    expectedCash: whole,
    methods: z
      .array(z.looseObject({ name: z.string().max(200), kind: z.string().max(40), isActive: z.boolean(), total: whole, tendersCount: whole }))
      .max(MAX_LINES),
  }),
  tax: z.strictObject({ type: z.enum(['INC', 'IVA']), rate: z.number().min(0).max(100) }).optional(),
});

/** The stored command fields (PrintService.printCommand), filled by the server. */
export interface CommandJobInput {
  items: Record<string, unknown>[];
  waiter: string;
  orderNumber: number;
  table?: number | null;
  delivery?: Record<string, unknown>;
  /** S8: a takeaway order's customer, printed instead of the table. */
  takeaway?: { customerName: string; label: string };
}

/** The comanda header of a takeaway order (S8), as renderKitchenOrder prints it. */
export const takeawayLabel = (customerName: string) => `PARA LLEVAR · ${customerName}`;

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

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Null or absent for delivery orders; the order's table wins; dropped for a takeaway order (the payload carries takeaway instead)." })
  table?: number | null;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'DeliveryPrintInfo (types/index.ts).' })
  delivery?: Record<string, unknown>;
}

export class XReportBusiness {
  @ApiProperty({ maxLength: 200 }) name!: string;
  @ApiProperty({ maxLength: 100 }) nit!: string;
  @ApiProperty({ maxLength: 300 }) address!: string;
}

export class XReportTax {
  @ApiProperty({ enum: ['INC', 'IVA'] }) type!: 'INC' | 'IVA';
  @ApiProperty({ minimum: 0, maximum: 100 }) rate!: number;
}

export class XReportPrintRequest {
  @ApiProperty({ type: XReportBusiness }) business!: XReportBusiness;
  @ApiProperty({ type: String, nullable: true, maxLength: 200 }) cashierName!: string | null;
  @ApiProperty({ format: 'date-time', description: "Opening of the shift in the cashier's wall time with its offset (printed as written)." })
  openedAt!: string;
  @ApiProperty({ format: 'date-time', description: "Print time in the cashier's wall time with its offset (printed as written)." })
  printedAt!: string;
  @ApiProperty({ type: RegisterSummary, description: 'GET /registers/summary exactly as it answered.' }) summary!: RegisterSummary;
  @ApiPropertyOptional({ type: XReportTax, description: 'Configured tax; without it no Base / tax line is printed.' }) tax?: XReportTax;
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
      'invoice: {invoiceNumber, invoice, displayItems, station?}; x_report: XReportPrintRequest plus station? (Caja); command: {invoiceNumber (job id), orderNumber?, items, waiter, table?, delivery?, takeaway? {customerName, label "PARA LLEVAR · <nombre>"} (instead of table), station?}. Lines may carry modifiers [{group, name, price}] (F7; invoice line prices include them); readers ignore keys they do not know. station {id, name} only when the restaurant has stations (F6): one command per station with its lines, Caja on invoices and x_report.',
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
