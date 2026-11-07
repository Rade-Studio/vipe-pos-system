import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { DbClient } from '../db/db-client';
import { CONFIG_KEYS, type DesktopUpdateChannel } from '../settings/business-config';
import { type DesktopDevice, deviceQuery } from './desktop-identity';
import type {
  ackSchema,
  DesktopPendingJob,
  DesktopPrinter,
  DesktopStation,
  drawerEventSchema,
  heartbeatSchema,
  HeartbeatResponse,
  pendingJobsQuerySchema,
  printersSchema,
  StationKind,
  UpdateManifest,
} from './desktop.dto';
import { newestAbove, parseVersion } from './semver';

const iso = (value: Date | string) => new Date(value).toISOString();
const TARGET = /^[a-z0-9_-]{1,40}$/;
/** Tauri 2 sends the OS (`windows`) as {{target}}; `windows-x86_64` (target-arch) is read as `windows`. */
export const normalizeTarget = (target: string) => (target === 'windows-x86_64' ? 'windows' : target);

const MESSAGES = {
  stationInvalid: 'Una de las estaciones no existe en este restaurante.',
  tooManyPrinters: 'Un computador puede registrar hasta 20 impresoras.',
  printersInvalid: 'La lista de impresoras no es válida.',
  jobNotFound: 'Ese trabajo de impresión no existe en este restaurante.',
  versionInvalid: 'Versión o plataforma no válida.',
} as const;

const PRINTER_ERRORS: Record<string, { message: string; code: string }> = {
  'desktop_put_printers: station_invalid': { message: MESSAGES.stationInvalid, code: 'station_invalid' },
  'desktop_put_printers: too_many_printers': { message: MESSAGES.tooManyPrinters, code: 'too_many_printers' },
  'desktop_put_printers: printers_invalid': { message: MESSAGES.printersInvalid, code: 'printers_invalid' },
};

/** Contract kind of a station: Caja is cashier; every prep station is other (its color carries no meaning). */
export function stationKind(kind: string): StationKind {
  return kind === 'cashier' ? 'cashier' : 'other';
}

/** Channels a restaurant's devices see: pilot also receives every stable release. */
const visibleChannels = (channel: DesktopUpdateChannel) => (channel === 'pilot' ? ['pilot', 'stable'] : ['stable']);

/**
 * Desktop device routes (F5a). They run on the pool outside any app.user_id:
 * each call goes through a SECURITY DEFINER function keyed by the device's
 * token hash that re-checks revoked_at, so a revoke between the guard and
 * the call still answers 401 device_revoked.
 */
@Injectable()
export class DesktopDeviceService {
  constructor(
    private readonly client: DbClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async heartbeat(device: DesktopDevice, input: z.infer<typeof heartbeatSchema>): Promise<HeartbeatResponse> {
    const row = await this.one<{ channel: string; printing_enabled: boolean }>(
      'SELECT channel, printing_enabled FROM private.desktop_heartbeat($1, $2, $3, $4, $5)',
      [device.tokenHash, input.appVersion, JSON.stringify(input.printers), input.queue.pending, input.queue.failed],
    );
    const channel = CONFIG_KEYS.desktopUpdateChannel.read(row.channel);
    // Only what GET updates would serve: a base URL and a required release of the device's target.
    const current = parseVersion(input.appVersion);
    const offered = current !== null && this.env.desktopReleasesBaseUrl !== null;
    const required = offered ? await this.releases(channel, normalizeTarget(input.target ?? 'windows'), true) : [];
    const updateRequired = offered && newestAbove(required, current) !== undefined;
    return { serverTime: new Date().toISOString(), channel, printingEnabled: row.printing_enabled, ...(updateRequired ? { updateRequired } : {}) };
  }

  async stations(device: DesktopDevice): Promise<DesktopStation[]> {
    const rows = await this.query<{ id: string; name: string; kind: string; fixed: boolean; prints: string; product_count: number }>(
      'SELECT id, name, kind, fixed, prints, product_count FROM private.desktop_stations($1)',
      [device.tokenHash],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: stationKind(row.kind),
      fixed: row.fixed,
      prints: row.prints,
      productCount: row.product_count,
    }));
  }

  async putPrinters(device: DesktopDevice, printers: z.infer<typeof printersSchema>): Promise<DesktopPrinter[]> {
    try {
      const rows = await this.query<{
        id: string; name: string; model: string; connection: string; paper_mm: 58 | 80; has_drawer: boolean; station_ids: string[];
      }>('SELECT id, name, model, connection, paper_mm, has_drawer, station_ids FROM private.desktop_put_printers($1, $2)', [
        device.tokenHash,
        JSON.stringify(printers),
      ]);
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        model: row.model,
        connection: row.connection,
        paperMm: row.paper_mm,
        hasDrawer: row.has_drawer,
        stationIds: row.station_ids,
      }));
    } catch (error) {
      const known = PRINTER_ERRORS[(error as { message?: string }).message ?? ''];
      throw known ? new UnprocessableEntityException(known) : error;
    }
  }

  async pending(device: DesktopDevice, query: z.infer<typeof pendingJobsQuerySchema>): Promise<DesktopPendingJob[]> {
    const rows = await this.query<{ id: string; kind: string; station_id: string | null; payload: Record<string, unknown>; created_at: Date }>(
      'SELECT id, kind, station_id, payload, created_at FROM private.desktop_pending_jobs($1, $2, $3)',
      [device.tokenHash, query.after ?? null, query.limit ?? 500],
    );
    return rows.map((row) => ({ id: row.id, kind: row.kind, stationId: row.station_id, createdAt: iso(row.created_at), payload: row.payload }));
  }

  /** Idempotent: the first status of this device stays. */
  async ack(device: DesktopDevice, jobId: string, input: z.infer<typeof ackSchema>): Promise<void> {
    const row = await this.one<{ acked: boolean }>('SELECT private.desktop_ack_job($1, $2, $3, $4) AS acked', [
      device.tokenHash,
      jobId,
      input.status,
      input.reason ?? null,
    ]);
    if (!row.acked) {
      throw new NotFoundException({ message: MESSAGES.jobNotFound, code: 'job_not_found' });
    }
  }

  async drawerEvent(device: DesktopDevice, input: z.infer<typeof drawerEventSchema>): Promise<void> {
    await this.query('SELECT private.desktop_drawer_event($1, $2, $3, $4, $5)', [
      device.tokenHash,
      input.printerId,
      input.openedAt,
      input.reason,
      input.profileId ?? null,
    ]);
  }

  /** Tauri dynamic manifest of the newest release above `currentVersion`, or null (204). */
  async update(device: DesktopDevice, target: string, currentVersion: string): Promise<UpdateManifest | null> {
    const current = parseVersion(currentVersion);
    if (!current || !TARGET.test(target)) {
      throw new UnprocessableEntityException({ message: MESSAGES.versionInvalid, code: 'version_invalid' });
    }
    const row = await this.one<{ channel: string }>('SELECT private.desktop_channel($1) AS channel', [device.tokenHash]);
    const base = this.env.desktopReleasesBaseUrl;
    if (!base) {
      return null;
    }
    const channel = CONFIG_KEYS.desktopUpdateChannel.read(row.channel);
    const release = newestAbove(await this.releases(channel, normalizeTarget(target), false), current);
    return release
      ? { version: release.version, notes: release.notes, pub_date: iso(release.pub_date), url: `${base}/${release.file}`, signature: release.signature }
      : null;
  }

  /** Releases of the visible channels for one (normalised) target. */
  private releases(channel: DesktopUpdateChannel, target: string, requiredOnly: boolean) {
    return this.query<{ version: string; notes: string; pub_date: Date; file: string; signature: string }>(
      `SELECT version, notes, pub_date, file, signature FROM public.desktop_releases
        WHERE channel = ANY($1::text[]) AND target = $2 AND (NOT $3::boolean OR required)`,
      [visibleChannels(channel), target, requiredOnly],
    );
  }

  private async query<T>(text: string, values: unknown[]): Promise<T[]> {
    return deviceQuery(async () => (await this.client.pool.query(text, values)).rows as T[]);
  }

  private async one<T>(text: string, values: unknown[]): Promise<T> {
    return (await this.query<T>(text, values))[0];
  }
}
