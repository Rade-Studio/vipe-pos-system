import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../common/validation';

export const LABEL_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export const ZONE_MESSAGES = {
  hasTables: 'La zona tiene mesas; muévelas o elimínalas primero',
  duplicateName: 'Ya existe una zona con ese nombre',
  dimensionsTogether: 'El ancho y el fondo de la zona se indican juntos',
  dimensionsRange: 'Las medidas de la zona deben ser mayores que 0 y de máximo 200 metros',
} as const;

/** zones_width_m_check / zones_depth_m_check: metres, 0 < m <= 200. */
const metres = z
  .number(ZONE_MESSAGES.dimensionsRange)
  .gt(0, ZONE_MESSAGES.dimensionsRange)
  .max(200, ZONE_MESSAGES.dimensionsRange)
  .nullable();
/** zones_dimensions_check: both or neither, also in a patch (a lone one is refused, not merged). */
const dimensionsTogether = (value: { widthM?: number | null; depthM?: number | null }) =>
  (value.widthM === undefined) === (value.depthM === undefined) && (value.widthM === null) === (value.depthM === null);

const zoneName = z.string().trim().min(1).max(40);
/** Width / height of the floor; the zones_aspect_check range. */
const aspect = z.number().gt(0.25).lt(4);
const sortOrder = z.number().int().min(-100_000).max(100_000);
/** Wall labels, the zones_labels_check shape. */
const labels = z
  .array(
    z.strictObject({
      text: z.string().max(40).refine((value) => value.trim().length > 0, 'Required'),
      side: z.enum(LABEL_SIDES),
    }),
  )
  .max(12);

export const zoneListQuerySchema = z.strictObject({ includeInactive: booleanQuery.optional() });

const zoneFields = {
  name: zoneName,
  aspect: aspect.optional(),
  sortOrder: sortOrder.optional(),
  labels: labels.optional(),
  active: z.boolean().optional(),
  widthM: metres.optional(),
  depthM: metres.optional(),
};

export const createZoneSchema = z.strictObject(zoneFields).refine(dimensionsTogether, ZONE_MESSAGES.dimensionsTogether);

export const updateZoneSchema = z
  .strictObject({ ...zoneFields, name: zoneName.optional() })
  .refine(dimensionsTogether, ZONE_MESSAGES.dimensionsTogether);

export class ZoneLabel {
  @ApiProperty({ minLength: 1, maxLength: 40 }) text!: string;
  @ApiProperty({ enum: LABEL_SIDES }) side!: (typeof LABEL_SIDES)[number];
}

export class Zone {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Width / height of the floor.' }) aspect!: number;
  @ApiProperty() sortOrder!: number;
  @ApiProperty({ type: [ZoneLabel] }) labels!: ZoneLabel[];
  @ApiProperty() active!: boolean;
  @ApiProperty({ type: Number, nullable: true, description: 'Real width in metres; set with depthM or both null.' }) widthM!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Real depth in metres; set with widthM or both null.' }) depthM!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) createdAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt!: string | null;
}

export class CreateZoneRequest {
  @ApiProperty({ minLength: 1, maxLength: 40, description: 'Unique per restaurant, case-insensitive.' }) name!: string;
  @ApiPropertyOptional({ default: 1.6, description: 'Width / height, 0.25 < aspect < 4.' }) aspect?: number;
  @ApiPropertyOptional({ default: 0 }) sortOrder?: number;
  @ApiPropertyOptional({ type: [ZoneLabel], maxItems: 12, default: [] }) labels?: ZoneLabel[];
  @ApiPropertyOptional({ default: true }) active?: boolean;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: 200,
    description: 'Metres; widthM and depthM go together (both numbers or both null).',
  })
  widthM?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, exclusiveMinimum: true, minimum: 0, maximum: 200 }) depthM?: number | null;
}

export class UpdateZoneRequest {
  @ApiPropertyOptional({ minLength: 1, maxLength: 40 }) name?: string;
  @ApiPropertyOptional({ description: 'Width / height, 0.25 < aspect < 4.' }) aspect?: number;
  @ApiPropertyOptional() sortOrder?: number;
  @ApiPropertyOptional({ type: [ZoneLabel], maxItems: 12 }) labels?: ZoneLabel[];
  @ApiPropertyOptional() active?: boolean;
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: 200,
    description: 'Metres; widthM and depthM go together (both numbers or both null).',
  })
  widthM?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, exclusiveMinimum: true, minimum: 0, maximum: 200 }) depthM?: number | null;
}
