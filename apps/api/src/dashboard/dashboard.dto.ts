import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Window of the series and the popular dishes (lib/admin/dashboard.ts DAILY_SALES_DAYS / POPULAR_DISHES_DAYS). */
export const DEFAULT_DAYS = 30;
/** Rows of the popular dishes chart (POPULAR_DISHES_LIMIT). */
export const POPULAR_DISHES_LIMIT = 10;

export const summaryQuerySchema = z.strictObject({
  days: z
    .string()
    .regex(/^\d+$/, 'Expected a whole number of days')
    .transform(Number)
    .pipe(z.number().int().min(1).max(366))
    .optional(),
});

export class DailySales {
  @ApiProperty({ example: '2026-11-04', description: 'Calendar day in the restaurant timezone.' }) date!: string;
  @ApiProperty({ description: 'Sum of the paid orders created that day.' }) amount!: number;
}

export class PopularDish {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'A dish id sold under that name, if any.' })
  id!: string | null;
  @ApiProperty({ description: 'Item name as sold (the grouping key).' }) name!: string;
  @ApiProperty({ description: 'Units sold.' }) count!: number;
}

export class DashboardSummary {
  @ApiProperty({ description: 'Sum of `total` of the paid orders created since the first day of the month (restaurant timezone).' })
  monthSales!: number;
  @ApiProperty({ description: 'Orders in status `kitchen` right now.' }) kitchenOrders!: number;
  @ApiProperty({
    type: [DailySales],
    description: 'Days with paid sales since local midnight `days` days back, oldest first (days without sales are absent).',
  })
  dailySales!: DailySales[];
  @ApiProperty({
    type: [PopularDish],
    description: `Paid items in the same window grouped by name, most units first (ties by name), at most ${POPULAR_DISHES_LIMIT}.`,
  })
  popularDishes!: PopularDish[];
}
