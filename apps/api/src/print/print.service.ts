import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException, type OnApplicationBootstrap } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { DbClient } from '../db/db-client';
import { UnitOfWork } from '../db/unit-of-work';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ConfigService } from '../settings/config.service';
import type {
  commandPrintSchema,
  CreatedPrinterDevice,
  invoicePrintSchema,
  PendingPrintJob,
  PrinterDevice,
  PrintJobCreated,
  PrintJobKind,
  PrintJobsCreated,
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

/** A command line's dish: its `dishId`, else the leading uuid of its cart id (lib/menu/cart-dish-id). */
const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function dishIdOf(item: Record<string, unknown>): string | null {
  for (const value of [item.dishId, item.id]) {
    const match = typeof value === 'string' ? UUID_PREFIX.exec(value) : null;
    if (match) {
      return match[0].toLowerCase();
    }
  }
  return null;
}

interface StationRef {
  id: string;
  name: string;
  is_default: boolean;
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
    private readonly config: ConfigService,
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

  /** Tagged to Caja (payload `station` and print_jobs.station_id) when the restaurant has it; else the legacy payload. */
  async printInvoice(input: z.infer<typeof invoicePrintSchema>): Promise<PrintJobCreated> {
    const [cashier] = await this.rows<StationRef>(sql`SELECT id, name, is_default FROM public.stations WHERE kind = 'cashier'`);
    const payload = { invoiceNumber: input.invoice.invoiceNumber, invoice: input.invoice, displayItems: input.displayItems };
    return cashier
      ? this.enqueue(randomUUID(), 'invoice', { ...payload, station: { id: cashier.id, name: cashier.name } }, cashier.id)
      : this.enqueue(randomUUID(), 'invoice', payload);
  }

  /**
   * The job id is the command's invoiceNumber (it replaces the random client
   * number). Without prep stations: exactly the single legacy job. With them
   * (F6): one job per station, in station order, with only the lines routed
   * there by private.route_dishes (dish exception -> category -> default
   * station; a line without a dish goes to the default) and `station`
   * {id, name}; the response is the first job plus `jobs`.
   */
  async printCommand(input: z.infer<typeof commandPrintSchema>): Promise<PrintJobCreated | PrintJobsCreated> {
    const stations = await this.rows<StationRef>(sql`
      SELECT id, name, is_default FROM public.stations WHERE kind = 'prep' ORDER BY sort_order, lower(name), id`);
    if (stations.length === 0) {
      const id = randomUUID();
      return this.enqueue(id, 'command', { invoiceNumber: id, ...input });
    }
    const dishIds = [...new Set(input.items.map(dishIdOf).filter((id): id is string => id !== null))];
    const routes = new Map(
      (
        await this.rows<{ dish_id: string; station_id: string | null }>(sql`
          SELECT dish_id, station_id FROM private.route_dishes(${sql.param(dishIds)}::uuid[])`)
      ).map((row) => [row.dish_id, row.station_id]),
    );
    const fallback = (stations.find((station) => station.is_default) ?? stations[0]).id;
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const item of input.items) {
      const dishId = dishIdOf(item);
      const stationId = (dishId && routes.get(dishId)) || fallback;
      groups.set(stationId, [...(groups.get(stationId) ?? []), item]);
    }
    const jobs: PrintJobCreated[] = [];
    for (const station of stations.filter((candidate) => groups.has(candidate.id))) {
      const id = randomUUID();
      const payload = { invoiceNumber: id, ...input, items: groups.get(station.id), station: { id: station.id, name: station.name } };
      jobs.push(await this.enqueue(id, 'command', payload, station.id, jobs.length));
    }
    return { ...jobs[0], jobs };
  }

  /**
   * S2: the web print actions (POST /print/commands and /print/invoices) of a
   * restaurant without thermal printers queue nothing. The delivery console's
   * server-side comanda (DeliveryService) still queues: its response carries
   * the job (follow-up outside F6).
   */
  async assertPrinting(): Promise<void> {
    if (!(await this.config.get()).printingEnabled) {
      throw new ConflictException({ message: 'Este restaurante no usa impresoras', code: 'printing_disabled' });
    }
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

  /** `order` keeps the jobs of one comanda in station order for the (created_at, id) readers. */
  private async enqueue(
    id: string,
    kind: PrintJobKind,
    payload: Record<string, unknown>,
    stationId: string | null = null,
    order = 0,
  ): Promise<PrintJobCreated> {
    const [row] = await this.rows<{ restaurant_id: string; created_at: Date | string }>(sql`
      INSERT INTO public.print_jobs (id, kind, payload, station_id, created_at)
      VALUES (${id}, ${kind}, ${JSON.stringify(payload)}::jsonb, ${stationId}, now() + ${order} * interval '1 microsecond')
      RETURNING restaurant_id, created_at`);
    const createdAt = iso(row.created_at);
    this.uow.afterCommit(() => this.gateway.emitPrintJob(row.restaurant_id, { id, kind, payload, createdAt }));
    return { id, kind, createdAt };
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}
