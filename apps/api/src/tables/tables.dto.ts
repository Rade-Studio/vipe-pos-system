import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const TABLE_STATUSES = ['available', 'reserved', 'occupied', 'kitchen', 'served'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
/**
 * Release is refused from these (moved from WaiterView's client guard).
 * `delivered` is not a table status the app sets, but the guard listed it.
 */
export const UNRELEASABLE_STATUSES: readonly string[] = ['kitchen', 'delivered', 'served', 'reserved'];

const tableNumber = z.number().int().min(1).max(100_000);

export const createTableSchema = z.strictObject({
  number: tableNumber,
  status: z.enum(TABLE_STATUSES).optional(),
});

export const updateTableSchema = z.strictObject({
  number: tableNumber.optional(),
  status: z.enum(TABLE_STATUSES).optional(),
  waiterId: z.guid().nullable().optional(),
});

export const assignTableSchema = z.strictObject({ waiterId: z.guid() });
export const releaseTableSchema = z.strictObject({ force: z.boolean().optional() });

export class Table {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ enum: TABLE_STATUSES }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Waiter profile id.' }) waiterId!: string | null;
  @ApiProperty({ type: String, nullable: true }) waiterName!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set by the server on every write.' })
  updatedAt!: string | null;
}

export class CreateTableRequest {
  @ApiProperty({ minimum: 1 }) number!: number;
  @ApiPropertyOptional({ enum: TABLE_STATUSES, default: 'available' }) status?: TableStatus;
}

export class UpdateTableRequest {
  @ApiPropertyOptional({ minimum: 1 }) number?: number;
  @ApiPropertyOptional({ enum: TABLE_STATUSES, description: 'available also clears the waiter unless waiterId is given.' })
  status?: TableStatus;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) waiterId?: string | null;
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
