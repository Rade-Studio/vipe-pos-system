import { ConflictException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { toIso } from '../common/validation';
import { UnitOfWork } from '../db/unit-of-work';
import {
  type CategoryRoute,
  type createStationSchema,
  type DishRoute,
  type RouteSource,
  type Station,
  type StationColor,
  STATION_ERRORS,
  type StationErrorCode,
  type StationKind,
  type StationRoutes,
  type UnroutedDish,
  type updateStationSchema,
} from './stations.dto';

const EXCEPTIONS = { 404: NotFoundException, 409: ConflictException, 422: UnprocessableEntityException };

/** The HttpException of a STATION_ERRORS code; the body carries `code`. */
export function stationError(code: StationErrorCode): HttpException {
  const { status, message } = STATION_ERRORS[code];
  return new EXCEPTIONS[status]({ message, code });
}

interface StationRow {
  id: string;
  name: string;
  kind: StationKind;
  color: StationColor;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const COLUMNS = sql`id, name, kind, color, sort_order, is_default, created_at::text, updated_at::text`;
/** Prep stations first, then Caja; sort order, then name. */
const ORDER = sql`ORDER BY kind = 'cashier', sort_order, lower(name), id`;

const toStation = (row: StationRow): Station => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  color: row.color,
  sortOrder: row.sort_order,
  isDefault: row.is_default,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

/** The starter set of the empty state: "Crear Cocina, Barra y Caja". */
const STARTER: { name: string; kind: StationKind; color: StationColor }[] = [
  { name: 'Cocina', kind: 'prep', color: 'kitchen' },
  { name: 'Barra', kind: 'prep', color: 'served' },
  { name: 'Caja', kind: 'cashier', color: 'occupied' },
];

/** The pg error behind a Drizzle error (its `cause` chain). */
function pgError(error: unknown): { code: string; message: string; constraint?: string } | undefined {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, message: current.message, constraint: typeof constraint === 'string' ? constraint : undefined };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Station writes refused by the 0020 constraints and triggers, as STATION_ERRORS. */
function toStationException(error: unknown): HttpException | undefined {
  const pg = pgError(error);
  if (!pg) {
    return undefined;
  }
  if (pg.code === '23505' && pg.constraint === 'stations_restaurant_id_name_key') return stationError('station_name_taken');
  if (pg.code === '23505' && pg.constraint === 'stations_one_cashier_key') return stationError('cashier_exists');
  if (pg.message === 'stations: too_many') return stationError('too_many_stations');
  if (pg.message === 'route_station: cashier_station') return stationError('cashier_route');
  if (pg.code === '23503') return stationError('station_invalid');
  const raised = /^delete_station: (station_not_found|cashier_station|move_required|target_invalid)$/.exec(pg.message);
  return raised ? stationError(raised[1] as StationErrorCode) : undefined;
}

/**
 * Stations and routes of the caller's restaurant. RLS scopes every read to
 * it and every write to its admin; a station leaves only through
 * public.delete_station, which moves its routes in the same transaction.
 */
@Injectable()
export class StationsService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<Station[]> {
    return (await this.rows<StationRow>(sql`SELECT ${COLUMNS} FROM public.stations ${ORDER}`)).map(toStation);
  }

  /** Without sortOrder the station goes after the last one. */
  async create(input: z.infer<typeof createStationSchema>): Promise<Station> {
    const sortOrder = input.sortOrder ?? sql`(SELECT coalesce(max(sort_order) + 1, 0) FROM public.stations)`;
    const [row] = await this.guarded(
      this.rows<StationRow>(sql`
        INSERT INTO public.stations (name, kind, color, sort_order)
        VALUES (${input.name}, ${input.kind ?? 'prep'}, ${input.color ?? 'kitchen'}, ${sortOrder})
        RETURNING ${COLUMNS}`),
    );
    return toStation(row);
  }

  /** Cocina (the default), Barra and Caja, only while the restaurant has no station. */
  async createStarter(): Promise<Station[]> {
    await this.uow.db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('stations:' || private.current_restaurant_id()::text, 0))`);
    const [any] = await this.rows(sql`SELECT 1 FROM public.stations LIMIT 1`);
    if (any) {
      throw stationError('stations_exist');
    }
    for (const [index, station] of STARTER.entries()) {
      await this.guarded(
        this.rows(sql`INSERT INTO public.stations (name, kind, color, sort_order) VALUES (${station.name}, ${station.kind}, ${station.color}, ${index})`),
      );
    }
    return this.list();
  }

  async update(id: string, input: z.infer<typeof updateStationSchema>): Promise<Station> {
    const sets: SQL[] = [];
    if (input.name !== undefined) sets.push(sql`name = ${input.name}`);
    if (input.color !== undefined) sets.push(sql`color = ${input.color}`);
    if (input.sortOrder !== undefined) sets.push(sql`sort_order = ${input.sortOrder}`);
    const [row] = await this.guarded(
      this.rows<StationRow>(sql`UPDATE public.stations SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLUMNS}`),
    );
    if (!row) {
      throw stationError('station_not_found');
    }
    return toStation(row);
  }

  async remove(id: string, moveTo: string | null): Promise<void> {
    await this.guarded(this.uow.db.execute(sql`SELECT public.delete_station(${id}::uuid, ${moveTo}::uuid)`));
  }

  async setCategoryRoute(id: string, stationId: string | null): Promise<void> {
    const rows = await this.guarded(
      this.rows(sql`UPDATE public.categories SET station_id = ${stationId}, updated_at = now() WHERE id = ${id} RETURNING id`),
    );
    if (rows.length === 0) {
      throw stationError('category_not_found');
    }
  }

  async setDishRoute(id: string, stationId: string | null): Promise<void> {
    const rows = await this.guarded(
      this.rows(sql`UPDATE public.dishes SET station_id = ${stationId}, updated_at = now() WHERE id = ${id} RETURNING id`),
    );
    if (rows.length === 0) {
      throw stationError('dish_not_found');
    }
  }

  /** Every category and dish with its route and, through private.route_dishes, where its lines go now. */
  async routes(): Promise<StationRoutes> {
    const categories = await this.rows<{ id: string; name: string; station_id: string | null; dish_count: number }>(sql`
      SELECT c.id, c.name, c.station_id, (SELECT count(*)::int FROM public.dishes d WHERE d.category_id = c.id) AS dish_count
        FROM public.categories c
       ORDER BY c.sort_order, c.name, c.id`);
    const dishes = await this.rows<{
      id: string;
      name: string;
      category_id: string | null;
      category_name: string | null;
      active: boolean;
      station_id: string | null;
      routed_station_id: string | null;
      source: RouteSource | null;
    }>(sql`
      SELECT d.id, d.name, d.category_id, c.name AS category_name, d.active, d.station_id,
             r.station_id AS routed_station_id, r.source
        FROM public.dishes d
        LEFT JOIN public.categories c ON c.id = d.category_id
        LEFT JOIN private.route_dishes(ARRAY(SELECT id FROM public.dishes)) r ON r.dish_id = d.id
       ORDER BY c.sort_order NULLS LAST, c.name, d.sort_order, d.name, d.id`);
    return {
      categories: categories.map(
        (row): CategoryRoute => ({ id: row.id, name: row.name, stationId: row.station_id, dishCount: row.dish_count }),
      ),
      dishes: dishes.map(
        (row): DishRoute => ({
          id: row.id,
          name: row.name,
          categoryId: row.category_id,
          active: row.active,
          stationId: row.station_id,
          routedStationId: row.routed_station_id,
          source: row.source,
        }),
      ),
      unroutedDishes: dishes
        .filter((row) => row.active && row.source === 'fallback')
        .map((row): UnroutedDish => ({ id: row.id, name: row.name, categoryId: row.category_id, categoryName: row.category_name })),
    };
  }

  private async guarded<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } catch (error) {
      throw toStationException(error) ?? error;
    }
  }

  private async rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
    return (await this.uow.db.execute(query)).rows as T[];
  }
}
