import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { sql } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type { createProductionTemplateSchema, ProductionTemplate, updateProductionTemplateSchema } from './inventory.dto';
import { definedColumns, one, rows, setList } from './inventory-sql';
import { toTemplate } from './inventory.mappers';

type Json = Record<string, unknown>;
type Lines = z.infer<typeof createProductionTemplateSchema>['lines'];

/**
 * Named quantity sets that fill the daily production sheet (S4). The table is
 * admin only through RLS; lines must be active preparations of the tenant
 * (ingredients RLS hides other tenants, so a foreign id is unknown too). A
 * duplicate name (case-insensitive, per restaurant) is 23505 -> 409.
 */
@Injectable()
export class ProductionTemplatesService {
  constructor(private readonly uow: UnitOfWork) {}

  async list(): Promise<ProductionTemplate[]> {
    const result = await rows<{ template: Json }>(this.uow, sql`
      SELECT to_jsonb(t) AS template FROM public.production_templates t ORDER BY lower(t.name), t.id`);
    return result.map((row) => toTemplate(row.template));
  }

  async create(input: z.infer<typeof createProductionTemplateSchema>): Promise<ProductionTemplate> {
    const lines = await this.storedLines(input.lines);
    const [row] = await rows<{ template: Json }>(this.uow, sql`
      INSERT INTO public.production_templates (name, lines, created_by)
      VALUES (${input.name}, ${lines}::jsonb, private.current_profile_id())
      RETURNING to_jsonb(production_templates.*) AS template`);
    return toTemplate(row.template);
  }

  async update(id: string, input: z.infer<typeof updateProductionTemplateSchema>): Promise<ProductionTemplate> {
    const lines = input.lines ? sql`${await this.storedLines(input.lines)}::jsonb` : undefined;
    const columns = definedColumns({ name: input.name, lines });
    const query = columns.length
      ? sql`UPDATE public.production_templates SET ${setList(columns)}, updated_at = now()
             WHERE id = ${id} RETURNING to_jsonb(production_templates.*) AS template`
      : sql`SELECT to_jsonb(t) AS template FROM public.production_templates t WHERE t.id = ${id}`;
    return toTemplate(await one<Json>(this.uow, query, 'template', 'Production template not found'));
  }

  async remove(id: string): Promise<void> {
    await one(this.uow, sql`DELETE FROM public.production_templates WHERE id = ${id} RETURNING id`, 'id', 'Production template not found');
  }

  /** `[{item_id, quantity}]` as jsonb text, or 422 naming the ids that are not active preparations. */
  private async storedLines(lines: Lines): Promise<string> {
    const itemIds = lines.map((line) => line.itemId);
    const known = await rows<{ id: string }>(this.uow, sql`
      SELECT i.id FROM public.ingredients i
       WHERE i.id = ANY(${sql.param(itemIds)}::uuid[]) AND i.kind = 'prep' AND i.is_active`);
    const found = new Set(known.map((row) => row.id));
    const unknown = itemIds.filter((itemId) => !found.has(itemId));
    if (unknown.length) {
      throw new UnprocessableEntityException(`Unknown preparation: ${unknown.join(', ')}`);
    }
    return JSON.stringify(lines.map((line) => ({ item_id: line.itemId, quantity: line.quantity })));
  }
}
