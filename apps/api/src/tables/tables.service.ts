import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type createTableSchema,
  type saveLayoutSchema,
  type reserveTableSchema,
  type Table,
  type TableShape,
  UNRELEASABLE_STATUSES,
  type updateTableSchema,
  type Waiter,
} from './tables.dto';

/**
 * Auto-placement of a table created without coordinates: the zone is split
 * into GRID x GRID cells, filled row by row; the first cell whose area holds
 * no table centre gets the table (w = h = SLOT_SIZE, seats left NULL for the
 * admin to set, like the migration 0012 backfill). When every cell is taken the table joins the zone
 * unplaced (no coordinates) and the admin drags it from the editor.
 */
const GRID = 8;
/** An arrival time this far in the past is still accepted (clock skew, a late tap). */
const ARRIVAL_GRACE_MS = 5 * 60_000;
const RESERVED = 'reserved';
/** Leaving 'reserved' clears these (tables_reservation_check, migration 0022). */
const CLEAR_RESERVATION = sql`reservation_name = NULL, reservation_arrival_at = NULL, reserved_by = NULL, reserved_at = NULL`;
const SLOT_SIZE = 0.1;

const LAYOUT_COLUMNS = ['zoneId', 'x', 'y', 'w', 'h', 'shape', 'rotation', 'seats'] as const;
const COLUMN: Record<(typeof LAYOUT_COLUMNS)[number], SQL> = {
  zoneId: sql`zone_id`,
  x: sql`x`,
  y: sql`y`,
  w: sql`w`,
  h: sql`h`,
  shape: sql`shape`,
  rotation: sql`rotation`,
  seats: sql`seats`,
};

interface TableRow {
  id: string;
  number: number;
  status: string;
  waiter_id: string | null;
  waiter_name: string | null;
  zone_id: string | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  shape: TableShape;
  rotation: number;
  seats: number | null;
  is_active: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  reservation_name: string | null;
  reservation_arrival_at: Date | string | null;
  reserved_at: Date | string | null;
  reserved_by_name: string | null;
}

/** timestamptz from a raw query: a Date or Postgres text depending on the driver's type parsers. */
const iso = (value: Date | string | null) => (value instanceof Date ? value.toISOString() : toIso(value));

const toTable = (row: TableRow): Table => ({
  id: row.id,
  number: row.number,
  status: row.status,
  waiterId: row.waiter_id,
  waiterName: row.waiter_name,
  zoneId: row.zone_id,
  x: row.x,
  y: row.y,
  w: row.w,
  h: row.h,
  shape: row.shape,
  rotation: row.rotation,
  seats: row.seats,
  isActive: row.is_active,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  reservationName: row.reservation_name,
  reservationArrivalAt: iso(row.reservation_arrival_at),
  reservedAt: iso(row.reserved_at),
  reservedByName: row.reserved_by_name,
});

function assertArrival(arrivalAt: string | null | undefined): void {
  if (arrivalAt && Date.parse(arrivalAt) < Date.now() - ARRIVAL_GRACE_MS) {
    throw new UnprocessableEntityException({ message: 'Arrival time is in the past', code: 'arrival_in_past' });
  }
}

/**
 * Tables of the caller's restaurant; RLS scopes every statement. Every write
 * sets updated_at with the server clock (clients never send timestamps).
 */
@Injectable()
export class TablesService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<Table[]> {
    return (await this.select(sql`ORDER BY t.number, t.id`)).map(toTable);
  }

  /**
   * Without coordinates the table is auto-placed on its zone (the first
   * active zone by sort order and name when zoneId is omitted); zoneId: null
   * leaves it off the plan.
   */
  async create(input: z.infer<typeof createTableSchema>): Promise<Table> {
    const zoneId = input.zoneId !== undefined ? input.zoneId : await this.firstZone();
    const placed = input.x !== undefined && input.x !== null;
    const slot = !placed && zoneId ? await this.freeSlot(zoneId) : undefined;
    const [row] = await this.rows<{ id: string }>(sql`
      INSERT INTO public.tables (number, status, zone_id, x, y, w, h, shape, rotation, seats, is_active)
      VALUES (${input.number}, ${input.status ?? 'available'}, ${zoneId},
              ${slot?.x ?? input.x ?? null}, ${slot?.y ?? input.y ?? null},
              ${slot ? SLOT_SIZE : (input.w ?? null)}, ${slot ? SLOT_SIZE : (input.h ?? null)},
              ${input.shape ?? 'square'}, ${input.rotation ?? 0},
              ${input.seats !== undefined ? input.seats : null}, ${input.isActive ?? true})
      RETURNING id`);
    return this.get(row.id);
  }

  /**
   * The editor's "Guardar cambios": every row in one request transaction, so
   * a table of another restaurant (invisible under RLS: Unknown table) or a
   * value the database refuses (a zone of another restaurant) rolls back the
   * rows already written. Returns every table, like GET /tables.
   */
  async saveLayout(input: z.infer<typeof saveLayoutSchema>): Promise<Table[]> {
    for (const table of input.tables) {
      const [row] = await this.rows(sql`
        UPDATE public.tables
           SET zone_id = ${table.zoneId}, x = ${table.x}, y = ${table.y}, w = ${table.w}, h = ${table.h},
               shape = ${table.shape}, rotation = ${table.rotation}, seats = ${table.seats}, updated_at = now()
         WHERE id = ${table.id}
        RETURNING id`);
      if (!row) {
        throw new UnprocessableEntityException('Unknown table');
      }
    }
    return this.list();
  }

  /**
   * status 'reserved' needs reservationName unless the table is already
   * reserved (422 reservation_name_required); the admin becomes reserved_by.
   * Any other status clears the reservation.
   */
  async update(id: string, input: z.infer<typeof updateTableSchema>, callerProfileId: string): Promise<Table> {
    const table = await this.lock(id);
    const reserved = (input.status ?? table.status) === RESERVED;
    const touchesReservation = input.reservationName !== undefined || input.reservationArrivalAt !== undefined;
    if (touchesReservation && !reserved) {
      throw new UnprocessableEntityException('Reservation fields need status reserved');
    }
    if (reserved && table.status !== RESERVED && input.reservationName === undefined) {
      throw new UnprocessableEntityException({ message: 'A reservation needs a name', code: 'reservation_name_required' });
    }
    assertArrival(input.reservationArrivalAt);
    if (input.waiterId) {
      await this.assertWaiter(input.waiterId);
    }
    // Like tableService.updateTableStatus: making a table available clears its waiter.
    const waiterId = input.waiterId !== undefined ? input.waiterId : input.status === 'available' ? null : undefined;
    const sets: SQL[] = [sql`updated_at = now()`];
    if (input.number !== undefined) sets.push(sql`number = ${input.number}`);
    if (input.status !== undefined) sets.push(sql`status = ${input.status}`);
    if (waiterId !== undefined) sets.push(sql`waiter_id = ${waiterId}`);
    if (input.isActive !== undefined) sets.push(sql`is_active = ${input.isActive}`);
    if (input.reservationName !== undefined) sets.push(sql`reservation_name = ${input.reservationName}`);
    if (input.reservationArrivalAt !== undefined) sets.push(sql`reservation_arrival_at = ${input.reservationArrivalAt}`);
    if (reserved && table.status !== RESERVED) sets.push(sql`reserved_by = ${callerProfileId}, reserved_at = now()`);
    if (!reserved && table.status === RESERVED) sets.push(CLEAR_RESERVATION);
    for (const key of LAYOUT_COLUMNS) {
      if (input[key] !== undefined) sets.push(sql`${COLUMN[key]} = ${input[key]}`);
    }
    await this.uow.db.execute(sql`UPDATE public.tables SET ${sql.join(sets, sql`, `)} WHERE id = ${id}`);
    return this.get(id);
  }

  /**
   * 409 while an order of the table is open (active, kitchen or delivered); paid
   * and cancelled orders are history (F1 keeps cancelled orders instead of
   * deleting them). Was a client-side check in tableService.delete.
   */
  async remove(id: string): Promise<void> {
    await this.lock(id);
    const [open] = await this.rows(sql`
      SELECT 1 FROM public.orders WHERE table_id = ${id} AND status IN ('active', 'kitchen', 'delivered') LIMIT 1`);
    if (open) {
      throw new ConflictException('Table has open orders');
    }
    await this.uow.db.execute(sql`DELETE FROM public.tables WHERE id = ${id}`);
  }

  async assign(id: string, waiterId: string): Promise<Table> {
    await this.lock(id);
    await this.assertWaiter(waiterId);
    await this.uow.db.execute(sql`
      UPDATE public.tables SET waiter_id = ${waiterId}, status = 'occupied', ${CLEAR_RESERVATION}, updated_at = now() WHERE id = ${id}`);
    return this.get(id);
  }

  /**
   * Only a free table: available with no open order (active, kitchen or
   * delivered, like remove), else 409 table_not_available.
   */
  async reserve(id: string, input: z.infer<typeof reserveTableSchema>, callerProfileId: string): Promise<Table> {
    const table = await this.lock(id);
    assertArrival(input.arrivalAt);
    const [open] = await this.rows(sql`
      SELECT 1 FROM public.orders WHERE table_id = ${id} AND status IN ('active', 'kitchen', 'delivered') LIMIT 1`);
    if (table.status !== 'available' || open) {
      throw new ConflictException({ message: 'Table is not available', code: 'table_not_available' });
    }
    await this.uow.db.execute(sql`
      UPDATE public.tables
         SET status = ${RESERVED}, waiter_id = NULL, reservation_name = ${input.name},
             reservation_arrival_at = ${input.arrivalAt ?? null}, reserved_by = ${callerProfileId},
             reserved_at = now(), updated_at = now()
       WHERE id = ${id}`);
    return this.get(id);
  }

  /** Release guard of WaiterView, now on the server; only an admin may force it. Releasing a reserved table cancels the reservation. */
  async release(id: string, force: boolean, callerRole: string): Promise<Table> {
    const table = await this.lock(id);
    if (UNRELEASABLE_STATUSES.includes(table.status) && !(force && callerRole === 'admin')) {
      throw new ConflictException(`Table cannot be released while ${table.status}`);
    }
    await this.uow.db.execute(sql`
      UPDATE public.tables SET waiter_id = NULL, status = 'available', ${CLEAR_RESERVATION}, updated_at = now() WHERE id = ${id}`);
    return this.get(id);
  }

  /** Active waiters of the restaurant, by name (hooks/use-waiters, the portal). */
  async waiters(): Promise<Waiter[]> {
    return this.rows<Waiter>(sql`
      SELECT id, full_name AS name, username FROM public.profiles
       WHERE role = 'waiter' AND active ORDER BY full_name, id`);
  }

  private async firstZone(): Promise<string | null> {
    const [zone] = await this.rows<{ id: string }>(sql`
      SELECT id FROM public.zones WHERE active ORDER BY sort_order, lower(name), id LIMIT 1`);
    return zone?.id ?? null;
  }

  /** Centre of the first grid cell of the zone without a table centre in it. */
  private async freeSlot(zoneId: string): Promise<{ x: number; y: number } | undefined> {
    const centres = await this.rows<{ x: number; y: number }>(sql`
      SELECT x::float8 AS x, y::float8 AS y FROM public.tables WHERE zone_id = ${zoneId} AND x IS NOT NULL`);
    const cell = (value: number) => Math.min(GRID - 1, Math.floor(value * GRID));
    const taken = new Set(centres.map((centre) => cell(centre.y) * GRID + cell(centre.x)));
    for (let index = 0; index < GRID * GRID; index++) {
      if (!taken.has(index)) {
        return { x: ((index % GRID) + 0.5) / GRID, y: (Math.floor(index / GRID) + 0.5) / GRID };
      }
    }
    return undefined;
  }

  private async get(id: string): Promise<Table> {
    const [row] = await this.select(sql`WHERE t.id = ${id}`);
    if (!row) {
      throw new NotFoundException('Table not found');
    }
    return toTable(row);
  }

  private async lock(id: string): Promise<{ status: string }> {
    const [table] = await this.rows<{ status: string }>(sql`SELECT status FROM public.tables WHERE id = ${id} FOR UPDATE`);
    if (!table) {
      throw new NotFoundException('Table not found');
    }
    return table;
  }

  /** The foreign key would accept another restaurant's profile; RLS on this SELECT does not. */
  private async assertWaiter(id: string): Promise<void> {
    const [profile] = await this.rows(sql`
      SELECT 1 FROM public.profiles WHERE id = ${id} AND active AND role IN ('waiter', 'admin')`);
    if (!profile) {
      throw new UnprocessableEntityException('Unknown waiter');
    }
  }

  private select(tail: SQL): Promise<TableRow[]> {
    return this.rows<TableRow>(sql`
      SELECT t.id, t.number, t.status, t.waiter_id, p.full_name AS waiter_name,
             t.zone_id, t.x::float8 AS x, t.y::float8 AS y, t.w::float8 AS w, t.h::float8 AS h,
             t.shape, t.rotation::float8 AS rotation, t.seats, t.is_active, t.created_at, t.updated_at,
             t.reservation_name, t.reservation_arrival_at, t.reserved_at, rp.full_name AS reserved_by_name
        FROM public.tables t
        LEFT JOIN public.profiles p ON p.id = t.waiter_id
        LEFT JOIN public.profiles rp ON rp.id = t.reserved_by
       ${tail}`);
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return result.rows as T[];
  }
}
