import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const TABLE_STATUSES = ['available', 'reserved', 'occupied', 'kitchen', 'served'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
/**
 * Release is refused from these (moved from WaiterView's client guard).
 * `delivered` is not a table status the app sets, but the guard listed it.
 */
export const UNRELEASABLE_STATUSES: readonly string[] = ['kitchen', 'delivered', 'served', 'reserved'];

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
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set by the server on every write.' })
  updatedAt!: string | null;
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
}

export class UpdateTableRequest extends TableLayoutFields {
  @ApiPropertyOptional({ minimum: 1 }) number?: number;
  @ApiPropertyOptional({ enum: TABLE_STATUSES, description: 'available also clears the waiter unless waiterId is given.' })
  status?: TableStatus;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) waiterId?: string | null;
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
  @ApiPropertyOptional({ default: false, description: 'Admin only: release from kitchen, delivered, served or reserved.' })
  force?: boolean;
}

export class Waiter {
  @ApiProperty({ format: 'uuid', description: 'Profile id.' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) username!: string | null;
}
