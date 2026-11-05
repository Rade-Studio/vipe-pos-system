import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { DbClient } from '../db/db-client';
import { UnitOfWork } from '../db/unit-of-work';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type {
  commandPrintSchema,
  CreatedPrinterDevice,
  invoicePrintSchema,
  PendingPrintJob,
  PrinterDevice,
  PrintJobCreated,
  PrintJobKind,
} from './print.dto';
import { newPrinterToken, type Printer } from './printer-identity';

/** timestamptz from a raw query: a Date or Postgres text depending on the driver's type parsers. */
const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : toIso(value));
const isoOrNull = (value: Date | string | null) => (value === null ? null : iso(value));

interface PrinterRow {
  id: string;
  name: string;
  created_at: Date | string;
  revoked_at: Date | string | null;
  last_seen_at: Date | string | null;
}

const toPrinter = (row: PrinterRow): PrinterDevice => ({
  id: row.id,
  name: row.name,
  createdAt: iso(row.created_at),
  revokedAt: isoOrNull(row.revoked_at),
  lastSeenAt: isoOrNull(row.last_seen_at),
});

/**
 * Durable print queue (T8c). Web sessions enqueue in their request
 * transaction (RLS by tenant) and the job reaches `printers:<restaurantId>`
 * only after the commit. Printers read and acknowledge through the SECURITY
 * DEFINER helpers keyed by their token hash; they never hold app.user_id.
 */
@Injectable()
export class PrintService implements OnApplicationBootstrap {
  private readonly logger = new Logger('PrintService');

  constructor(
    private readonly uow: UnitOfWork,
    private readonly client: DbClient,
    private readonly gateway: RealtimeGateway,
  ) {}

  /** Jobs older than 7 days are dropped on start; a database that is down does not stop the API. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      const { rows } = await this.client.pool.query<{ deleted: number; unprinted: number }>(
        'SELECT deleted, unprinted FROM private.prune_print_jobs()',
      );
      const { deleted = 0, unprinted = 0 } = rows[0] ?? {};
      if (unprinted) {
        this.logger.warn(`pruned ${unprinted} print jobs older than 7 days that were never printed`);
      }
      if (deleted) {
        this.logger.log(`pruned ${deleted} print jobs older than 7 days`);
      }
    } catch (error) {
      this.logger.warn(`print job pruning skipped: ${(error as Error).message}`);
    }
  }

  printInvoice(input: z.infer<typeof invoicePrintSchema>): Promise<PrintJobCreated> {
    return this.enqueue(randomUUID(), 'invoice', {
      invoiceNumber: input.invoice.invoiceNumber,
      invoice: input.invoice,
      displayItems: input.displayItems,
    });
  }

  /** The job id is the command's invoiceNumber (it replaces the random client number). */
  printCommand(input: z.infer<typeof commandPrintSchema>): Promise<PrintJobCreated> {
    const id = randomUUID();
    return this.enqueue(id, 'command', { invoiceNumber: id, ...input });
  }

  /** Oldest first, at most 500; `after` continues after that job id. */
  async pending(printer: Printer, after?: string): Promise<PendingPrintJob[]> {
    const { rows } = await this.client.pool.query<{
      id: string;
      kind: PrintJobKind;
      payload: Record<string, unknown>;
      created_at: Date | string;
    }>('SELECT id, kind, payload, created_at FROM private.printer_pending_jobs($1, $2)', [printer.tokenHash, after ?? null]);
    return rows.map((row) => ({ id: row.id, kind: row.kind, payload: row.payload, createdAt: iso(row.created_at) }));
  }

  /** Idempotent: a job already printed stays with its first printed_at. */
  async ack(printer: Printer, jobId: string): Promise<void> {
    const { rows } = await this.client.pool.query<{ acked: boolean }>('SELECT private.ack_print_job($1, $2) AS acked', [
      printer.tokenHash,
      jobId,
    ]);
    if (!rows[0]?.acked) {
      throw new NotFoundException('Print job not found');
    }
  }

  async listPrinters(): Promise<PrinterDevice[]> {
    return (
      await this.rows<PrinterRow>(sql`
        SELECT id, name, created_at, revoked_at, last_seen_at FROM public.printer_tokens ORDER BY created_at, id`)
    ).map(toPrinter);
  }

  async createPrinter(name: string): Promise<CreatedPrinterDevice> {
    const { token, hash } = newPrinterToken();
    const [row] = await this.rows<PrinterRow>(sql`
      INSERT INTO public.printer_tokens (name, token_hash) VALUES (${name}, ${hash})
      RETURNING id, name, created_at, revoked_at, last_seen_at`);
    return { ...toPrinter(row), token };
  }

  /** Revokes the token (idempotent) and, after the commit, drops its live sockets. */
  async revokePrinter(id: string): Promise<void> {
    const [row] = await this.rows<{ id: string }>(sql`
      UPDATE public.printer_tokens SET revoked_at = coalesce(revoked_at, now()) WHERE id = ${id} RETURNING id`);
    if (!row) {
      throw new NotFoundException('Printer not found');
    }
    this.uow.afterCommit(() => this.gateway.disconnectPrinter(id));
  }

  private async enqueue(id: string, kind: PrintJobKind, payload: Record<string, unknown>): Promise<PrintJobCreated> {
    const [row] = await this.rows<{ restaurant_id: string; created_at: Date | string }>(sql`
      INSERT INTO public.print_jobs (id, kind, payload) VALUES (${id}, ${kind}, ${JSON.stringify(payload)}::jsonb)
      RETURNING restaurant_id, created_at`);
    const createdAt = iso(row.created_at);
    this.uow.afterCommit(() => this.gateway.emitPrintJob(row.restaurant_id, { id, kind, payload, createdAt }));
    return { id, kind, createdAt };
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}
