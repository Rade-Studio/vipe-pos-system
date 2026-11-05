import { Injectable } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import type {
  createCategorySchema,
  createItemSchema,
  createLocationSchema,
  createPreparationSchema,
  createSupplierSchema,
  InventoryCategory,
  InventoryItem,
  InventoryLocation,
  itemListQuerySchema,
  Supplier,
  updateCategorySchema,
  updateItemSchema,
  updateLocationSchema,
  updateSupplierSchema,
} from './inventory.dto';
import { definedColumns, insertColumns, one, rows, rpc, setList, trimmed } from './inventory-sql';
import { toCategory, toItem, toLocation, toSupplier } from './inventory.mappers';

type Json = Record<string, unknown>;
type ItemInput = z.infer<typeof updateItemSchema>;

const ITEM_NOT_FOUND = 'Inventory item not found';

/** One item with its category name, for a query whose FROM has `public.ingredients i`. */
const itemJson = sql`to_jsonb(i) || jsonb_build_object('category_name',
  (SELECT c.name FROM public.ingredient_categories c WHERE c.id = i.category_id))`;

/** The item columns an input writes; a blank SKU is NULL so the guard trigger assigns MP-/PR-####. */
const itemColumns = (input: ItemInput) =>
  definedColumns({
    name: trimmed(input.name),
    unit: input.unit,
    kind: input.kind,
    sku: input.sku === undefined ? undefined : input.sku?.trim() ? input.sku.trim().toUpperCase() : null,
    description: input.description,
    barcode: input.barcode,
    min_stock: input.minStock,
    max_stock: input.maxStock,
    purchase_unit: input.purchaseUnit,
    purchase_factor: input.purchaseFactor,
    default_supplier_id: input.defaultSupplierId,
    track_lots: input.trackLots,
    shelf_life_days: input.shelfLifeDays,
    is_active: input.isActive,
    category_id: input.categoryId,
  });

/**
 * Inventory master data: items (`ingredients`) and their categories,
 * locations and suppliers. Writes go to the tables through RLS (admin only);
 * `stock` and `cost` move only through the inventory RPCs (guard trigger).
 */
@Injectable()
export class ItemsService {
  constructor(private readonly uow: UnitOfWork) {}

  async listItems(query: z.infer<typeof itemListQuerySchema>): Promise<InventoryItem[]> {
    const where: SQL[] = [];
    if (query.kind) where.push(sql`i.kind = ${query.kind}`);
    if (query.includeInactive === false) where.push(sql`i.is_active`);
    const filter = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
    const result = await rows<{ item: Json }>(this.uow, sql`
      SELECT ${itemJson} AS item FROM public.ingredients i ${filter} ORDER BY i.name, i.id`);
    return result.map((row) => toItem(row.item));
  }

  async getItem(id: string): Promise<InventoryItem> {
    return toItem(
      await one<Json>(this.uow, sql`SELECT ${itemJson} AS item FROM public.ingredients i WHERE i.id = ${id}`, 'item', ITEM_NOT_FOUND),
    );
  }

  /**
   * The insert and the optional opening stock (`inventory_adjust` opening,
   * reason "Stock inicial", at `locationId` or the default location) share the
   * request transaction, so a failed opening leaves no item.
   */
  async createItem(input: z.infer<typeof createItemSchema>): Promise<InventoryItem> {
    const { openingStock, ...fields } = input;
    const [row] = await rows<{ id: string }>(this.uow, sql`
      INSERT INTO public.ingredients ${insertColumns(itemColumns(fields))} RETURNING id`);
    if (openingStock) {
      await rpc(this.uow, sql`
        SELECT public.inventory_adjust(
          p_ingredient_id => ${row.id}::uuid,
          p_location_id => ${openingStock.locationId ?? null}::uuid,
          p_movement_type => 'opening',
          p_quantity => ${openingStock.quantity}::numeric,
          p_unit_cost => ${openingStock.unitCost ?? null}::numeric,
          p_reason => 'Stock inicial') AS result`);
    }
    return this.getItem(row.id);
  }

  async updateItem(id: string, input: ItemInput): Promise<InventoryItem> {
    const columns = itemColumns(input);
    if (columns.length) {
      await one(this.uow, sql`UPDATE public.ingredients SET ${setList(columns)} WHERE id = ${id} RETURNING id`, 'id', ITEM_NOT_FOUND);
    }
    return this.getItem(id);
  }

  /** A `kind = 'prep'` item ready for save_formula; `yieldQuantity` is not an item column. */
  async createPreparation(input: z.infer<typeof createPreparationSchema>): Promise<InventoryItem> {
    const [row] = await rows<{ id: string }>(this.uow, sql`
      INSERT INTO public.ingredients (name, unit, kind, category_id)
      VALUES (${input.name}, ${input.unit}, 'prep', ${input.categoryId ?? null})
      RETURNING id`);
    return this.getItem(row.id);
  }

  // ---- categories ----

  async listCategories(): Promise<InventoryCategory[]> {
    const result = await rows<{ category: Json }>(this.uow, sql`
      SELECT to_jsonb(c) AS category FROM public.ingredient_categories c ORDER BY c.name, c.id`);
    return result.map((row) => toCategory(row.category));
  }

  async createCategory(input: z.infer<typeof createCategorySchema>): Promise<InventoryCategory> {
    const [row] = await rows<{ category: Json }>(this.uow, sql`
      INSERT INTO public.ingredient_categories (name, description) VALUES (${input.name}, ${input.description ?? null})
      RETURNING to_jsonb(ingredient_categories.*) AS category`);
    return toCategory(row.category);
  }

  async updateCategory(id: string, input: z.infer<typeof updateCategorySchema>): Promise<InventoryCategory> {
    const columns = definedColumns({ name: input.name, description: input.description });
    const query = columns.length
      ? sql`UPDATE public.ingredient_categories SET ${setList(columns)} WHERE id = ${id} RETURNING to_jsonb(ingredient_categories.*) AS category`
      : sql`SELECT to_jsonb(c) AS category FROM public.ingredient_categories c WHERE c.id = ${id}`;
    return toCategory(await one<Json>(this.uow, query, 'category', 'Inventory category not found'));
  }

  /** Items of a deleted category keep existing with `category_id = null` (FK ON DELETE SET NULL). */
  async deleteCategory(id: string): Promise<void> {
    await one(this.uow, sql`DELETE FROM public.ingredient_categories WHERE id = ${id} RETURNING id`, 'id', 'Inventory category not found');
  }

  // ---- locations ----

  /** Default location first, then by name. */
  async listLocations(): Promise<InventoryLocation[]> {
    const result = await rows<{ location: Json }>(this.uow, sql`
      SELECT to_jsonb(l) AS location FROM public.inventory_locations l ORDER BY l.is_default DESC, l.name, l.id`);
    return result.map((row) => toLocation(row.location));
  }

  async createLocation(input: z.infer<typeof createLocationSchema>): Promise<InventoryLocation> {
    const [row] = await rows<{ location: Json }>(this.uow, sql`
      INSERT INTO public.inventory_locations ${insertColumns(locationColumns(input))}
      RETURNING to_jsonb(inventory_locations.*) AS location`);
    return toLocation(row.location);
  }

  async updateLocation(id: string, input: z.infer<typeof updateLocationSchema>): Promise<InventoryLocation> {
    const columns = locationColumns(input);
    const query = columns.length
      ? sql`UPDATE public.inventory_locations SET ${setList(columns)} WHERE id = ${id} RETURNING to_jsonb(inventory_locations.*) AS location`
      : sql`SELECT to_jsonb(l) AS location FROM public.inventory_locations l WHERE l.id = ${id}`;
    return toLocation(await one<Json>(this.uow, query, 'location', 'Inventory location not found'));
  }

  // ---- suppliers ----

  async listSuppliers(): Promise<Supplier[]> {
    const result = await rows<{ supplier: Json }>(this.uow, sql`
      SELECT to_jsonb(s) AS supplier FROM public.suppliers s ORDER BY s.name, s.id`);
    return result.map((row) => toSupplier(row.supplier));
  }

  async createSupplier(input: z.infer<typeof createSupplierSchema>): Promise<Supplier> {
    const [row] = await rows<{ supplier: Json }>(this.uow, sql`
      INSERT INTO public.suppliers ${insertColumns(supplierColumns(input))} RETURNING to_jsonb(suppliers.*) AS supplier`);
    return toSupplier(row.supplier);
  }

  async updateSupplier(id: string, input: z.infer<typeof updateSupplierSchema>): Promise<Supplier> {
    const columns = supplierColumns(input);
    const query = columns.length
      ? sql`UPDATE public.suppliers SET ${setList(columns)} WHERE id = ${id} RETURNING to_jsonb(suppliers.*) AS supplier`
      : sql`SELECT to_jsonb(s) AS supplier FROM public.suppliers s WHERE s.id = ${id}`;
    return toSupplier(await one<Json>(this.uow, query, 'supplier', 'Supplier not found'));
  }
}

/** Code trimmed and upper-cased, as locations-service.ts sent it. */
const locationColumns = (input: z.infer<typeof updateLocationSchema>) =>
  definedColumns({
    name: input.name,
    code: input.code?.toUpperCase(),
    is_default: input.isDefault,
    is_active: input.isActive,
  });

const supplierColumns = (input: z.infer<typeof updateSupplierSchema>) =>
  definedColumns({
    name: input.name,
    tax_id: input.taxId,
    contact_name: input.contactName,
    phone: input.phone,
    email: input.email,
    lead_time_days: input.leadTimeDays,
    notes: input.notes,
    is_active: input.isActive,
  });
