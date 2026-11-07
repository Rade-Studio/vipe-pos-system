import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Stations and routes (odd/tasks/fase3-operacion.md F6, L10, L11, migration
 * 0020). A prep station receives the comanda lines routed to it; the one
 * cashier station (Caja) receives facturas and precuentas and never a dish.
 */
export const STATION_KINDS = ['prep', 'cashier'] as const;
export type StationKind = (typeof STATION_KINDS)[number];
/** Status tokens of design/system.md (kitchen orange, served sky, occupied violet, free green, reserved grey). */
export const STATION_COLORS = ['kitchen', 'served', 'occupied', 'free', 'reserved'] as const;
export type StationColor = (typeof STATION_COLORS)[number];
export const ROUTE_SOURCES = ['dish', 'category', 'fallback'] as const;
export type RouteSource = (typeof ROUTE_SOURCES)[number];

/** Every refusal of the stations routes: stable code, HTTP status and the Spanish message. The body carries `code`. */
export const STATION_ERRORS = {
  station_name_taken: { status: 409, message: 'Ya existe una estación con ese nombre' },
  cashier_exists: { status: 409, message: 'El restaurante ya tiene su estación Caja' },
  too_many_stations: { status: 409, message: 'Un restaurante puede tener hasta 20 estaciones' },
  stations_exist: { status: 409, message: 'El restaurante ya tiene estaciones' },
  station_not_found: { status: 404, message: 'Estación no encontrada' },
  cashier_station: { status: 409, message: 'La estación Caja no se puede eliminar' },
  cashier_route: { status: 422, message: 'Caja recibe facturas y precuentas; elige una estación de preparación' },
  move_required: { status: 422, message: 'Elige a qué estación pasan sus categorías y platos' },
  target_invalid: { status: 422, message: 'Elige otra estación de preparación del restaurante' },
  station_invalid: { status: 422, message: 'Estación no encontrada' },
  category_not_found: { status: 404, message: 'Categoría no encontrada' },
  dish_not_found: { status: 404, message: 'Plato no encontrado' },
} as const;
export type StationErrorCode = keyof typeof STATION_ERRORS;

const NAME_MESSAGE = 'El nombre de la estación debe tener entre 1 y 40 caracteres';
const name = z.string({ error: NAME_MESSAGE }).trim().min(1, { error: NAME_MESSAGE }).max(40, { error: NAME_MESSAGE });
const sortOrder = z.number().int().min(0).max(1000);

export const createStationSchema = z.strictObject({
  name,
  kind: z.enum(STATION_KINDS).optional(),
  color: z.enum(STATION_COLORS).optional(),
  sortOrder: sortOrder.optional(),
});

export const updateStationSchema = z
  .strictObject({ name: name.optional(), color: z.enum(STATION_COLORS).optional(), sortOrder: sortOrder.optional() })
  .refine((value) => Object.values(value).some((field) => field !== undefined), 'Nothing to update');

/** moveTo: where the categories, dish exceptions and sent lines go; null only when no other prep station exists. */
export const deleteStationSchema = z.strictObject({ moveTo: z.guid().nullable().optional() });

/** null clears the route (the category goes to the default station; the dish follows its category). */
export const setRouteSchema = z.strictObject({ stationId: z.guid().nullable() });

export class Station {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: STATION_KINDS, description: 'prep: receives comanda lines; cashier: Caja, facturas and precuentas.' })
  kind!: StationKind;
  @ApiProperty({ enum: STATION_COLORS }) color!: StationColor;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ description: 'The prep station that receives dishes without a route (the first one created).' }) isDefault!: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}

export class CreateStationRequest {
  @ApiProperty({ minLength: 1, maxLength: 40 }) name!: string;
  @ApiPropertyOptional({ enum: STATION_KINDS, default: 'prep', description: 'One cashier station per restaurant.' }) kind?: StationKind;
  @ApiPropertyOptional({ enum: STATION_COLORS, default: 'kitchen' }) color?: StationColor;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000, description: 'Default: after the last station.' }) sortOrder?: number;
}

export class UpdateStationRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 }) name?: string;
  @ApiPropertyOptional({ enum: STATION_COLORS }) color?: StationColor;
  @ApiPropertyOptional({ minimum: 0, maximum: 1000 }) sortOrder?: number;
}

export class DeleteStationRequest {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Prep station that takes the routes.' })
  moveTo?: string | null;
}

export class SetRouteRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'A prep station; null clears the route.' })
  stationId!: string | null;
}

export class CategoryRoute {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Default station; null = no route.' }) stationId!: string | null;
  @ApiProperty({ description: 'Dishes of the category, active or not.' }) dishCount!: number;
}

export class DishRoute {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'The exception; null = same as the category.' })
  stationId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Where its lines go now; null without prep stations.' })
  routedStationId!: string | null;
  @ApiProperty({ enum: ROUTE_SOURCES, nullable: true, type: String }) source!: RouteSource | null;
}

export class UnroutedDish {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) categoryId!: string | null;
  @ApiProperty({ type: String, nullable: true }) categoryName!: string | null;
}

export class StationRoutes {
  @ApiProperty({ type: [CategoryRoute], description: 'Menu order.' }) categories!: CategoryRoute[];
  @ApiProperty({ type: [DishRoute], description: 'By category order, then dish order and name.' }) dishes!: DishRoute[];
  @ApiProperty({ type: [UnroutedDish], description: 'Active dishes that go to the default station only because nothing routes them.' })
  unroutedDishes!: UnroutedDish[];
}
