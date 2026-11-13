import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sql, type SQL } from '@vipe/db';
import type { z } from 'zod';
import { UnitOfWork } from '../db/unit-of-work';
import { ConfigService } from '../settings/config.service';
import type { UploadTicket } from '../storage/storage.dto';
import { StorageService } from '../storage/storage.service';
import {
  CARTA_ADMIN_MESSAGES as M,
  type CartaAdmin,
  type CartaAdminDaypart,
  type CartaAdminRestaurant,
  type CartaAdminSettings,
  type CartaAdminTable,
  type cartaAssetSchema,
  type cartaDaypartsSchema,
  type CartaDishDetails,
  type cartaSettingsSchema,
  type dishDetailsSchema,
} from './carta-admin.dto';

/** carta_settings defaults (0036) when the restaurant never configured its carta. */
const DEFAULT_SETTINGS: CartaAdminSettings = {
  published: false,
  description: null,
  brandColor: null,
  logoUrl: null,
  coverUrl: null,
  instagram: null,
  tiktok: null,
  whatsapp: null,
  mapsUrl: null,
  googleReviewUrl: null,
  tableOrderingEnabled: false,
  deliveryOrderingEnabled: false,
  showTableBill: true,
  englishEnabled: true,
  openingHours: null,
};

/** The `<function>: <code>` errors of regenerate_table_qr_token (0036) and set_restaurant_slug (0039). */
const DB_CODES: Record<string, () => HttpException> = {
  admin_required: () => new ForbiddenException(),
  table_not_found: () => new NotFoundException(M.tableNotFound),
  slug_invalid: () => new UnprocessableEntityException(M.slug),
  slug_taken: () => new ConflictException(M.slugTaken),
};

/**
 * Rethrow a known function error (pg directly, or Drizzle's `cause` chain) as
 * its HTTP answer; any other database error is a generic 422, never the DB
 * text (the request transaction rolls back either way). Anything else unchanged.
 */
function adminDbError(error: unknown): never {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth++) {
    const match = /^(regenerate_table_qr_token|set_restaurant_slug): ([a-z_]+)$/.exec(current.message);
    const make = match ? DB_CODES[match[2]] : undefined;
    if (make) {
      throw make();
    }
    const { code } = current as { code?: unknown };
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      throw new UnprocessableEntityException(M.saveFailed);
    }
    current = current.cause;
  }
  throw error;
}

/**
 * "Ajustes · Carta digital" (S17) inside the request unit of work: RLS scopes
 * every read to the caller's restaurant and lets only an admin write the 0036
 * tables; tokens and the slug change through their admin-only functions.
 * The restaurant never comes from the client.
 */
@Injectable()
export class CartaAdminService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async get(): Promise<CartaAdmin> {
    const restaurant = await this.restaurant();
    const [settings, dayparts, categories, dishes, tables, config] = await Promise.all([
      this.settings(),
      this.dayparts(),
      this.rows<CartaAdmin['categories'][number]>(sql`
        SELECT jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active) AS row
          FROM public.categories c ORDER BY c.sort_order, c.name, c.id`),
      this.rows<CartaAdmin['dishes'][number]>(sql`
        WITH most_ordered AS (
          -- guest_menu_data's "Lo más pedido" (0036): units of the active dishes on paid
          -- orders of the last 30 days, voided lines out, top 5.
          SELECT oi.dish_id
            FROM public.order_items oi
            JOIN public.orders o ON o.restaurant_id = oi.restaurant_id AND o.id = oi.order_id
            JOIN public.dishes d ON d.restaurant_id = oi.restaurant_id AND d.id = oi.dish_id AND d.active
           WHERE o.status = 'paid' AND o.created_at >= now() - interval '30 days'
             AND oi.status IS DISTINCT FROM 'cancelled' AND oi.quantity > 0
           GROUP BY oi.dish_id
           ORDER BY sum(oi.quantity) DESC, oi.dish_id
           LIMIT 5)
        SELECT jsonb_build_object(
                 'id', d.id, 'name', d.name, 'description', d.description, 'price', d.price, 'categoryId', d.category_id,
                 'imageUrl', d.image_url, 'active', d.active, 'tags', to_jsonb(coalesce(x.tags, '{}'::text[])),
                 'descriptionEn', x.description_en, 'descriptionEnReviewed', coalesce(x.description_en_reviewed, false),
                 'mostOrdered', EXISTS (SELECT 1 FROM most_ordered m WHERE m.dish_id = d.id)) AS row
          FROM public.dishes d
          LEFT JOIN public.dish_public_details x ON x.restaurant_id = d.restaurant_id AND x.dish_id = d.id
         ORDER BY d.name, d.id`),
      this.tables(restaurant.slug),
      this.config.get(),
    ]);
    return { restaurant, settings, dayparts, categories, dishes, tables, deliveryDefaultFee: config.deliveryDefaultFee };
  }

  /**
   * Upsert: omitted fields keep their stored value (or the default). The row is
   * created first and locked, so concurrent saves of different fields merge
   * one after the other instead of overwriting each other.
   */
  async updateSettings(input: z.infer<typeof cartaSettingsSchema>): Promise<CartaAdminSettings> {
    await this.uow.db.execute(sql`
      INSERT INTO public.carta_settings (restaurant_id) VALUES (private.current_restaurant_id()) ON CONFLICT (restaurant_id) DO NOTHING`);
    await this.uow.db.execute(sql`SELECT 1 FROM public.carta_settings FOR UPDATE`);
    const defined = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    const s: CartaAdminSettings = { ...(await this.settings()), ...defined };
    await this.uow.db.execute(sql`
      INSERT INTO public.carta_settings AS cs (
        restaurant_id, published, description, brand_color, logo_url, cover_url, instagram, tiktok, whatsapp, maps_url,
        google_review_url, table_ordering_enabled, delivery_ordering_enabled, show_table_bill, english_enabled, opening_hours)
      VALUES (
        private.current_restaurant_id(), ${s.published}, ${s.description}, ${s.brandColor}, ${s.logoUrl}, ${s.coverUrl},
        ${s.instagram}, ${s.tiktok}, ${s.whatsapp}, ${s.mapsUrl}, ${s.googleReviewUrl}, ${s.tableOrderingEnabled},
        ${s.deliveryOrderingEnabled}, ${s.showTableBill}, ${s.englishEnabled},
        ${s.openingHours === null ? null : JSON.stringify(s.openingHours)}::jsonb)
      ON CONFLICT (restaurant_id) DO UPDATE SET
        published = EXCLUDED.published, description = EXCLUDED.description, brand_color = EXCLUDED.brand_color,
        logo_url = EXCLUDED.logo_url, cover_url = EXCLUDED.cover_url, instagram = EXCLUDED.instagram, tiktok = EXCLUDED.tiktok,
        whatsapp = EXCLUDED.whatsapp, maps_url = EXCLUDED.maps_url, google_review_url = EXCLUDED.google_review_url,
        table_ordering_enabled = EXCLUDED.table_ordering_enabled, delivery_ordering_enabled = EXCLUDED.delivery_ordering_enabled,
        show_table_bill = EXCLUDED.show_table_bill, english_enabled = EXCLUDED.english_enabled, opening_hours = EXCLUDED.opening_hours`);
    return this.settings();
  }

  /** The whole list in the request transaction: every id is checked before the first write. */
  async replaceDayparts(input: z.infer<typeof cartaDaypartsSchema>): Promise<CartaAdminDaypart[]> {
    try {
      return await this.writeDayparts(input);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      return adminDbError(error);
    }
  }

  private async writeDayparts(input: z.infer<typeof cartaDaypartsSchema>): Promise<CartaAdminDaypart[]> {
    const categoryIds = [...new Set(input.dayparts.flatMap((daypart) => daypart.categoryIds))];
    const dishIds = [...new Set(input.dayparts.flatMap((daypart) => (daypart.featuredDishId ? [daypart.featuredDishId] : [])))];
    if ((await this.countVisible(sql`public.categories`, categoryIds)) !== categoryIds.length) {
      throw new UnprocessableEntityException(M.categories);
    }
    if ((await this.countVisible(sql`public.dishes`, dishIds)) !== dishIds.length) {
      throw new UnprocessableEntityException(M.featuredDish);
    }
    await this.uow.db.execute(sql`DELETE FROM public.carta_dayparts`);
    for (const [index, daypart] of input.dayparts.entries()) {
      const { rows } = await this.uow.db.execute(sql`
        INSERT INTO public.carta_dayparts (name, name_en, starts_at, ends_at, sort_order, featured_dish_id)
        VALUES (${daypart.name}, ${daypart.nameEn ?? null}, ${daypart.startsAt}::time, ${daypart.endsAt}::time,
                ${daypart.sortOrder ?? index}, ${daypart.featuredDishId ?? null}::uuid)
        RETURNING id`);
      const ids = [...new Set(daypart.categoryIds)];
      if (ids.length > 0) {
        await this.uow.db.execute(sql`
          INSERT INTO public.carta_daypart_categories (daypart_id, category_id)
          SELECT ${rows[0].id as string}::uuid, unnest(${sql.param(ids)}::uuid[])`);
      }
    }
    return this.dayparts();
  }

  async updateDish(dishId: string, input: z.infer<typeof dishDetailsSchema>): Promise<CartaDishDetails> {
    if ((await this.countVisible(sql`public.dishes`, [dishId])) !== 1) {
      throw new NotFoundException(M.dishNotFound);
    }
    const [row] = await this.rows<CartaDishDetails>(sql`
      INSERT INTO public.dish_public_details AS x (dish_id, tags, description_en, description_en_reviewed)
      VALUES (${dishId}::uuid, ${sql.param([...new Set(input.tags)])}::text[], ${input.descriptionEn ?? null}, ${input.descriptionEnReviewed})
      ON CONFLICT (dish_id) DO UPDATE SET
        tags = EXCLUDED.tags, description_en = EXCLUDED.description_en, description_en_reviewed = EXCLUDED.description_en_reviewed
      RETURNING jsonb_build_object('dishId', x.dish_id, 'tags', to_jsonb(x.tags), 'descriptionEn', x.description_en,
                                   'descriptionEnReviewed', x.description_en_reviewed) AS row`);
    return row;
  }

  async regenerateTable(tableId: string): Promise<CartaAdminTable> {
    await this.call(sql`SELECT private.regenerate_table_qr_token(${tableId}::uuid) AS row`);
    const { slug } = await this.restaurant();
    return (await this.tables(slug)).find((table) => table.id === tableId)!;
  }

  /** Every table of the restaurant in the request transaction: all or none. */
  async regenerateAll(): Promise<CartaAdminTable[]> {
    await this.call(sql`SELECT private.regenerate_table_qr_token(t.id) AS row FROM public.tables t ORDER BY t.id`);
    return this.tables((await this.restaurant()).slug);
  }

  async updateSlug(slug: string): Promise<CartaAdminRestaurant> {
    await this.call(sql`SELECT private.set_restaurant_slug(${slug}) AS row`);
    return this.restaurant();
  }

  createAsset(input: z.infer<typeof cartaAssetSchema>): Promise<UploadTicket> {
    return this.storage.createUpload({ contentType: input.contentType, size: input.size }, 'carta');
  }

  private async restaurant(): Promise<CartaAdminRestaurant> {
    const [row] = await this.rows<CartaAdminRestaurant>(sql`
      SELECT jsonb_build_object('name', r.name, 'slug', r.slug, 'publicPath', '/c/' || r.slug, 'timezone', r.timezone) AS row
        FROM public.restaurants r WHERE r.id = private.current_restaurant_id()`);
    return row;
  }

  private async settings(): Promise<CartaAdminSettings> {
    const [row] = await this.rows<CartaAdminSettings>(sql`
      SELECT jsonb_build_object(
               'published', s.published, 'description', s.description, 'brandColor', s.brand_color, 'logoUrl', s.logo_url,
               'coverUrl', s.cover_url, 'instagram', s.instagram, 'tiktok', s.tiktok, 'whatsapp', s.whatsapp,
               'mapsUrl', s.maps_url, 'googleReviewUrl', s.google_review_url, 'tableOrderingEnabled', s.table_ordering_enabled,
               'deliveryOrderingEnabled', s.delivery_ordering_enabled, 'showTableBill', s.show_table_bill,
               'englishEnabled', s.english_enabled, 'openingHours', s.opening_hours) AS row
        FROM public.carta_settings s`);
    return row ?? DEFAULT_SETTINGS;
  }

  /** guest_carta's daypart shape (0036) plus the stored sortOrder. */
  private dayparts(): Promise<CartaAdminDaypart[]> {
    return this.rows<CartaAdminDaypart>(sql`
      SELECT jsonb_build_object(
               'id', d.id, 'name', d.name, 'nameEn', d.name_en,
               'startsAt', to_char(d.starts_at, 'HH24:MI'), 'endsAt', to_char(d.ends_at, 'HH24:MI'),
               'sortOrder', d.sort_order, 'featuredDishId', d.featured_dish_id,
               'categoryIds', coalesce((
                 SELECT jsonb_agg(dc.category_id ORDER BY c.sort_order, c.name, c.id)
                   FROM public.carta_daypart_categories dc
                   JOIN public.categories c ON c.restaurant_id = dc.restaurant_id AND c.id = dc.category_id
                  WHERE dc.daypart_id = d.id), '[]'::jsonb)) AS row
        FROM public.carta_dayparts d
       ORDER BY d.sort_order, d.starts_at, d.id`);
  }

  private tables(slug: string): Promise<CartaAdminTable[]> {
    return this.rows<CartaAdminTable>(sql`
      SELECT jsonb_build_object('id', t.id, 'number', t.number, 'zoneName', z.name, 'token', q.token,
                                'guestPath', '/c/' || ${slug} || '/m/' || q.token) AS row
        FROM public.tables t
        JOIN public.table_qr_tokens q ON q.restaurant_id = t.restaurant_id AND q.table_id = t.id
        LEFT JOIN public.zones z ON z.restaurant_id = t.restaurant_id AND z.id = t.zone_id
       ORDER BY t.number, t.id`);
  }

  /** How many of `ids` the caller's restaurant has in `table` (RLS scopes the read). */
  private async countVisible(table: SQL, ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const { rows } = await this.uow.db.execute(sql`SELECT count(*)::integer AS n FROM ${table} WHERE id = ANY(${sql.param(ids)}::uuid[])`);
    return rows[0].n as number;
  }

  private async call(query: SQL): Promise<void> {
    try {
      await this.uow.db.execute(query);
    } catch (error) {
      adminDbError(error);
    }
  }

  private async rows<T>(query: SQL): Promise<T[]> {
    const result = await this.uow.db.execute(query);
    return (result.rows as { row: T }[]).map((r) => r.row);
  }
}
