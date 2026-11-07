import { Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import { UnitOfWork } from '../db/unit-of-work';
import type { AdminDesktopPrinter, DesktopDevice } from './desktop.dto';

const iso = (value: Date | string) => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null) => (value === null ? null : iso(value));
/** A device is online when it is not revoked and sent anything in the last 90 seconds. */
const ONLINE_MS = 90_000;

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  app_version: string;
  created_at: Date | string;
  last_seen_at: Date | string | null;
  revoked_at: Date | string | null;
  queue_pending: number;
  queue_failed: number;
  printer_status: { id?: unknown; status?: unknown }[];
}

interface PrinterRow {
  device_id: string;
  id: string;
  name: string;
  model: string;
  connection: string;
  paper_mm: 58 | 80;
  has_drawer: boolean;
  station_ids: string[];
}

const DEVICE_COLUMNS = sql`id, name, platform, app_version, created_at, last_seen_at, revoked_at, queue_pending, queue_failed, printer_status`;

/**
 * Admin view of the restaurant's desktop devices (F5a), in the request
 * transaction: RLS shows an admin only the devices of their restaurant and
 * never token_hash; renaming and revoking are the only writes.
 */
@Injectable()
export class DesktopAdminService {
  constructor(private readonly uow: UnitOfWork) {}

  /** Newest first, revoked devices included. */
  async list(): Promise<DesktopDevice[]> {
    const devices = await this.rows<DeviceRow>(sql`SELECT ${DEVICE_COLUMNS} FROM public.desktop_devices ORDER BY created_at DESC, id`);
    const printers = await this.rows<PrinterRow>(sql`
      SELECT p.device_id, p.id, p.name, p.model, p.connection, p.paper_mm, p.has_drawer,
             coalesce(array_agg(ps.station_id ORDER BY ps.station_id) FILTER (WHERE ps.station_id IS NOT NULL), '{}')::text[] AS station_ids
        FROM public.desktop_printers p
        LEFT JOIN public.desktop_printer_stations ps ON ps.device_id = p.device_id AND ps.printer_id = p.id
       GROUP BY p.device_id, p.id
       ORDER BY p.device_id, p.id`);
    return devices.map((row) => this.toDevice(row, printers.filter((printer) => printer.device_id === row.id)));
  }

  async rename(id: string, name: string): Promise<DesktopDevice> {
    const [row] = await this.rows<DeviceRow>(sql`UPDATE public.desktop_devices SET name = ${name} WHERE id = ${id} RETURNING ${DEVICE_COLUMNS}`);
    if (!row) {
      throw notFound();
    }
    return (await this.list()).find((device) => device.id === row.id)!;
  }

  /** Idempotent: the first revoked_at stays. The token answers 401 device_revoked from the next call. */
  async revoke(id: string): Promise<void> {
    const [row] = await this.rows<{ id: string }>(
      sql`UPDATE public.desktop_devices SET revoked_at = coalesce(revoked_at, now()) WHERE id = ${id} RETURNING id`,
    );
    if (!row) {
      throw notFound();
    }
  }

  private toDevice(row: DeviceRow, printers: PrinterRow[]): DesktopDevice {
    const lastSeen = row.last_seen_at === null ? null : new Date(row.last_seen_at).getTime();
    const status = new Map(
      (Array.isArray(row.printer_status) ? row.printer_status : [])
        .filter((entry) => typeof entry?.id === 'string' && typeof entry.status === 'string')
        .map((entry) => [entry.id as string, entry.status as string]),
    );
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      appVersion: row.app_version,
      createdAt: iso(row.created_at),
      lastSeenAt: isoOrNull(row.last_seen_at),
      online: row.revoked_at === null && lastSeen !== null && Date.now() - lastSeen <= ONLINE_MS,
      revokedAt: isoOrNull(row.revoked_at),
      queue: { pending: row.queue_pending, failed: row.queue_failed },
      printers: printers.map(
        (printer): AdminDesktopPrinter => ({
          id: printer.id,
          name: printer.name,
          model: printer.model,
          connection: printer.connection,
          paperMm: printer.paper_mm,
          hasDrawer: printer.has_drawer,
          stationIds: printer.station_ids,
          status: status.get(printer.id) ?? null,
        }),
      ),
    };
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}

const notFound = () => new NotFoundException({ message: 'Ese computador no existe en este restaurante.', code: 'device_not_found' });
