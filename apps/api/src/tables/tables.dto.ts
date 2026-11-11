import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const TABLE_STATUSES = ['available', 'reserved', 'occupied', 'kitchen', 'served'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
/**
 * Release is refused from these (moved from WaiterView's client guard).
 * `delivered` is not a table status the app sets, but the guard listed it.
 */
export const UNRELEASABLE_STATUSES: readonly string[] = ['kitchen', 'delivered', 'served'];
/** Only an open order puts a table here (orders flows, pay_order, cancel_order); PATCH refuses them on an empty table. */
export const ORDER_STATUSES: readonly string[] = ['kitchen', 'served'];
/** PATCH refuses these while the table has an open order, so the table never says "libre" over an unpaid order. */
export const NO_ORDER_STATUSES: readonly string[] = ['available', 'reserved'];
/** Statuses as the 409 messages say them ("mientras está servida"). */
export const STATUS_WORDS: Record<string, string> = {
  available: 'libre',
  reserved: 'reservada',
  occupied: 'ocupada',
  kitchen: 'en cocina',
  served: 'servida',
  delivered: 'entregada',
};
/** 409 messages of the tables endpoints, in the language the screens show them. */
export const TABLE_MESSAGES = {
  openOrders: 'La mesa tiene órdenes abiertas',
  statusNeedsOrder: 'La mesa no tiene una orden abierta: solo el flujo de pedidos la pone en cocina o servida.',
  statusHasOrder: 'La mesa tiene una orden abierta: cóbrala o cancélala antes de dejarla libre o reservada.',
  releaseHasOrder: 'La mesa tiene una orden abierta: cóbrala o cancélala antes de liberarla.',
  cannotRelease: (status: string) => `La mesa no se puede liberar mientras está ${STATUS_WORDS[status] ?? status}`,
} as const;

/** tables_reservation_name_check (0022): trimmed, 1..80 characters. */
export const RESERVATION_NAME_MAX = 80;
const reservationName = z.string().trim().min(1).max(RESERVATION_NAME_MAX);
const reservationArrivalAt = z.iso.datetime({ offset: true });

export const TABLE_SHAPES = ['round', 'square', 'rect', 'bar'] as const;
export type TableShape = (typeof TABLE_SHAPES)[number];
/** Most tables a layout save may carry. */
export const LAYOUT_MAX_TABLES = 500;

const tableNumber = z.number().int().min(1).max(100_000);

/** Floor plan columns of public.tables (migration 0012): x, y centre and w, h size, normalized 0-1. */
const layoutFields = {
  zoneId: z.guid().nullable(),
  x: z.number().min(0).max(1).nullable(),
  y: z.number().min(0).max(1).nullable(),
  w: z.number().gt(0).max(1).nullable(),
  h: z.number().gt(0).max(1).nullable(),
  shape: z.enum(TABLE_SHAPES),
  rotation: z.number().min(0).lt(360),
  seats: z.number().int().min(0).max(20).nullable(),
};

type Coordinates = { x?: number | null; y?: number | null; w?: number | null; h?: number | null };
/** tables_layout_check: the four coordinates are all set or none is. */
const allOrNoCoordinates = (value: Coordinates) =>
  [0, 4].includes([value.x, value.y, value.w, value.h].filter((part) => part !== undefined && part !== null).length);
const COORDINATES_MESSAGE = { message: 'x, y, w and h are set together or all null' };

export const createTableSchema = z
  .strictObject({
    number: tableNumber,
    status: z.enum(TABLE_STATUSES).optional(),
    zoneId: layoutFields.zoneId.optional(),
    x: layoutFields.x.optional(),
    y: layoutFields.y.optional(),
    w: layoutFields.w.optional(),
    h: layoutFields.h.optional(),
    shape: layoutFields.shape.optional(),
    rotation: layoutFields.rotation.optional(),
    seats: layoutFields.seats.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(allOrNoCoordinates, COORDINATES_MESSAGE);

/** A partial coordinate patch is checked against the stored row by tables_layout_check (422). */
export const updateTableSchema = z.strictObject({
  number: tableNumber.optional(),
  status: z.enum(TABLE_STATUSES).optional(),
  waiterId: z.guid().nullable().optional(),
  zoneId: layoutFields.zoneId.optional(),
  x: layoutFields.x.optional(),
  y: layoutFields.y.optional(),
  w: layoutFields.w.optional(),
  h: layoutFields.h.optional(),
  shape: layoutFields.shape.optional(),
  rotation: layoutFields.rotation.optional(),
  seats: layoutFields.seats.optional(),
  isActive: z.boolean().optional(),
  reservationName: reservationName.optional(),
  reservationArrivalAt: reservationArrivalAt.nullable().optional(),
});

export const tableLayoutSchema = z.strictObject({ id: z.guid(), ...layoutFields }).refine(allOrNoCoordinates, COORDINATES_MESSAGE);

export const saveLayoutSchema = z.strictObject({
  tables: z
    .array(tableLayoutSchema)
    .min(1)
    .max(LAYOUT_MAX_TABLES)
    .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length, 'Each table appears once'),
});

export const assignTableSchema = z.strictObject({ waiterId: z.guid() });
export const releaseTableSchema = z.strictObject({ force: z.boolean().optional() });
export const reserveTableSchema = z.strictObject({ name: reservationName, arrivalAt: reservationArrivalAt.optional() });

export class Table {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ enum: TABLE_STATUSES }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Waiter profile id.' }) waiterId!: string | null;
  @ApiProperty({ type: String, nullable: true }) waiterName!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Zone the table sits on.' }) zoneId!: string | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 1, description: 'Centre, fraction of the zone width.' })
  x!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 1, description: 'Centre, fraction of the zone height.' })
  y!: number | null;
  @ApiProperty({ type: Number, nullable: true, maximum: 1, description: 'Width, fraction of the zone width.' }) w!: number | null;
  @ApiProperty({ type: Number, nullable: true, maximum: 1, description: 'Height, fraction of the zone height.' }) h!: number | null;
  @ApiProperty({ enum: TABLE_SHAPES }) shape!: TableShape;
  @ApiProperty({ minimum: 0, maximum: 359.99, description: 'Degrees, 0 <= rotation < 360.' }) rotation!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 20, description: 'Chairs to draw; null or 0 draws none.' })
  seats!: number | null;
  @ApiProperty({
    description: 'An inactive table takes no new order (409 La mesa está inactiva); it is still listed, flagged, so the map greys it.',
  })
  isActive!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set by the server on every write.' })
  updatedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Name the table is reserved under; set exactly when status is reserved.' })
  reservationName!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Expected arrival, optional.' })
  reservationArrivalAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reservedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Who reserved; null for legacy reservations.' })
  reservedByName!: string | null;
}

/** Layout fields shared by the create, update and layout requests. */
class TableLayoutFields {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) zoneId?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 1, description: 'x, y, w and h go together.' })
  x?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 1 }) y?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, maximum: 1 }) w?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, maximum: 1 }) h?: number | null;
  @ApiPropertyOptional({ enum: TABLE_SHAPES }) shape?: TableShape;
  @ApiPropertyOptional({ minimum: 0, maximum: 359.99 }) rotation?: number;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0, maximum: 20 }) seats?: number | null;
}

export class CreateTableRequest extends TableLayoutFields {
  @ApiProperty({ minimum: 1 }) number!: number;
  @ApiPropertyOptional({ enum: TABLE_STATUSES, default: 'available' }) status?: TableStatus;
  @ApiPropertyOptional({ default: true }) isActive?: boolean;
}

export class UpdateTableRequest extends TableLayoutFields {
  @ApiPropertyOptional({ minimum: 1 }) number?: number;
  @ApiPropertyOptional({ enum: TABLE_STATUSES, description: 'available also clears the waiter unless waiterId is given.' })
  status?: TableStatus;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) waiterId?: string | null;
  @ApiPropertyOptional({ description: 'false: no new order on the table; its open orders are unaffected.' }) isActive?: boolean;
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: RESERVATION_NAME_MAX,
    description: 'Trimmed. Required when status becomes reserved (422 reservation_name_required); only with status reserved or on a reserved table.',
  })
  reservationName?: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Not more than 5 minutes ago (422 arrival_in_past).' })
  reservationArrivalAt?: string | null;
}

export class TableLayout {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) zoneId!: string | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 1, description: 'x, y, w and h go together.' }) x!: number | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 1 }) y!: number | null;
  @ApiProperty({ type: Number, nullable: true, maximum: 1 }) w!: number | null;
  @ApiProperty({ type: Number, nullable: true, maximum: 1 }) h!: number | null;
  @ApiProperty({ enum: TABLE_SHAPES }) shape!: TableShape;
  @ApiProperty({ minimum: 0, maximum: 359.99 }) rotation!: number;
  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 20 }) seats!: number | null;
}

export class SaveLayoutRequest {
  @ApiProperty({ type: [TableLayout], minItems: 1, maxItems: LAYOUT_MAX_TABLES, description: 'Each table once.' })
  tables!: TableLayout[];
}

export class AssignTableRequest {
  @ApiProperty({ format: 'uuid' }) waiterId!: string;
}

export class ReleaseTableRequest {
  @ApiPropertyOptional({ default: false, description: 'Admin only: release from kitchen, delivered or served (never over an open order).' })
  force?: boolean;
}

export class ReserveTableRequest {
  @ApiProperty({ minLength: 1, maxLength: RESERVATION_NAME_MAX, description: 'Trimmed.' }) name!: string;
  @ApiPropertyOptional({ format: 'date-time', description: 'Expected arrival; not more than 5 minutes ago (422 arrival_in_past).' })
  arrivalAt?: string;
}

export class Waiter {
  @ApiProperty({ format: 'uuid', description: 'Profile id.' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
}
