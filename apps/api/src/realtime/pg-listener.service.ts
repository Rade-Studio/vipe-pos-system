import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createListenerClient, type Notification } from '@vipe/db';
import type { DbClient } from '../db/db-client';
import { type ChangeEvent, type ChangeNotice, parseNotice, toChangeEvent } from './change-event';

export const CHANNEL = 'pos_changes';
/** Lets operators (and the specs) find the listener in pg_stat_activity. */
export const LISTENER_APPLICATION_NAME = 'vipe-realtime-listener';
/** A half-open socket gets no error event; a periodic query detects it. */
export const HEARTBEAT_MS = 30_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** The part of pg.Client the listener uses. */
export interface ListenerConnection {
  connect(): Promise<unknown>;
  query(text: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'notification', listener: (message: Notification) => void): unknown;
}

/** Where events go: RealtimeGateway in the app. */
export interface ChangeSink {
  broadcast(restaurantId: string, event: ChangeEvent): void;
  resyncAll(): void;
}

export interface ListenerOptions {
  applicationName?: string;
  createClient?: (databaseUrl: string, applicationName: string) => ListenerConnection;
}

type Row = Record<string, unknown>;

/**
 * LISTEN pos_changes on one dedicated connection (never the pool, which would
 * hand it to other work) as vipe_api. Each notification is turned into a
 * `pos_changes` event for the restaurant room it names: INSERT and UPDATE
 * load the new row through private.realtime_row on the pool; DELETE has no
 * new row; `old` comes from the trigger payload. Notifications are handled
 * one at a time so events keep the commit order.
 *
 * Any role can pg_notify on this channel, so the notice's restaurant_id is
 * cross-checked against the loaded row (INSERT/UPDATE) or the old row
 * (DELETE); a mismatch is dropped with a warning.
 *
 * A lost connection (error, end, or a failed heartbeat) is ended and
 * reconnects with exponential backoff (1 s to 30 s); NOTIFYs sent while it was
 * down are gone, so after every reconnect every client gets `resync` and
 * refetches. Built by RealtimeModule from ENV.
 */
export class PgListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PgListener');
  private readonly applicationName: string;
  private createClient: (databaseUrl: string, applicationName: string) => ListenerConnection;
  private client?: ListenerConnection;
  private stopped = false;
  private connectedOnce = false;
  private attempt = 0;
  private timer?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly databaseUrl: string,
    private readonly db: Pick<DbClient, 'pool'>,
    private readonly gateway: ChangeSink,
    options: ListenerOptions = {},
  ) {
    this.applicationName = options.applicationName ?? LISTENER_APPLICATION_NAME;
    this.createClient = options.createClient ?? createListenerClient;
  }

  async onModuleInit(): Promise<void> {
    // Like the pool, the API starts even when Postgres is not up yet: the
    // first failed attempt goes into the same backoff loop.
    await this.connect().catch((error: Error) => this.retry(error));
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    await this.client?.end().catch(() => undefined);
    await this.queue;
  }

  private async connect(): Promise<void> {
    const client = this.createClient(this.databaseUrl, this.applicationName);
    let lost = false;
    const onLost = (reason: string) => {
      if (lost) {
        return;
      }
      lost = true;
      // An errored socket may still be open: end it so it cannot keep
      // listening beside its replacement.
      client.end().catch(() => undefined);
      if (this.client === client) {
        this.client = undefined;
        clearInterval(this.heartbeat);
      }
      if (!this.stopped) {
        this.logger.warn(`listener connection lost: ${reason}`);
        this.scheduleReconnect();
      }
    };
    client.on('error', (error) => onLost(error.message));
    client.on('end', () => onLost('connection ended'));
    client.on('notification', (message) => this.enqueue(message));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (error) {
      lost = true;
      await client.end().catch(() => undefined);
      throw error;
    }
    if (this.stopped || lost) {
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
    this.attempt = 0;
    this.heartbeat = setInterval(() => {
      client.query('SELECT 1').catch((error: Error) => onLost(`heartbeat failed: ${error.message}`));
    }, HEARTBEAT_MS);
    if (this.connectedOnce) {
      this.logger.log('listener reconnected; asking clients to resync');
      this.gateway.resyncAll();
    }
    this.connectedOnce = true;
  }

  private scheduleReconnect(): void {
    const delay = Math.min(BACKOFF_MIN_MS * 2 ** this.attempt, BACKOFF_MAX_MS);
    this.attempt += 1;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.connect().catch((error: Error) => this.retry(error));
    }, delay);
  }

  private retry(error: Error): void {
    this.logger.warn(`listener connection failed: ${error.message}`);
    if (!this.stopped) {
      this.scheduleReconnect();
    }
  }

  private enqueue(message: Notification): void {
    const notice = message.channel === CHANNEL ? parseNotice(message.payload) : undefined;
    if (!notice) {
      return;
    }
    const at = new Date();
    this.queue = this.queue
      .then(() => this.dispatch(notice, at))
      .catch((error: Error) => this.logger.error(`dropped ${notice.table} ${notice.op}: ${error.message}`));
  }

  private async dispatch(notice: ChangeNotice, at: Date): Promise<void> {
    if (notice.op === 'DELETE') {
      // No row to cross-check; the old row must agree with the notice.
      const oldTenant = notice.old?.restaurant_id;
      if (oldTenant !== undefined && oldTenant !== notice.restaurant_id) {
        this.dropForged(notice, oldTenant);
        return;
      }
      this.gateway.broadcast(notice.restaurant_id, toChangeEvent(notice, undefined, at));
      return;
    }
    const { rows } = await this.db.pool.query<{ row: Row | null }>('SELECT private.realtime_row($1, $2) AS row', [
      notice.table,
      notice.id,
    ]);
    const newRow = rows[0]?.row;
    // Deleted before we loaded it: its DELETE notification follows.
    if (!newRow) {
      return;
    }
    const tenant = newRow.restaurant_id;
    if (tenant !== notice.restaurant_id) {
      this.dropForged(notice, tenant);
      return;
    }
    this.gateway.broadcast(tenant, toChangeEvent(notice, newRow, at));
  }

  private dropForged(notice: ChangeNotice, rowTenant: unknown): void {
    this.logger.warn(
      `dropped ${notice.table} ${notice.op} ${notice.id}: notice names restaurant ${notice.restaurant_id}, row belongs to ${String(rowTenant)}`,
    );
  }
}
