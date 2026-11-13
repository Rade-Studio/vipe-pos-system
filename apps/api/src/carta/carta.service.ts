import { Injectable, NotFoundException } from '@nestjs/common';
import type { MenuTreeDish } from '../catalog/catalog.dto';
import type { MenuChannel } from '../catalog/menu-data-source';
import { MenuService } from '../catalog/menu.service';
import { Clock } from '../common/clock';
import { DbClient } from '../db/db-client';
import { restaurantNow } from '../promotions/promotion-catalog.service';
import { type CartaLang, currentDaypartId, type OpeningHours, openingState, resolveLang } from './carta-schedule';
import {
  type Carta,
  CARTA_MESSAGES,
  type CartaDish,
  type CartaDishShare,
  type CartaMenu,
  type CartaSettings,
  type CartaTable,
  cartaDishIdSchema,
  cartaSlugSchema,
  tableTokenSchema,
} from './carta.dto';
import { type GuestMenuData, guestMenuSource } from './guest-menu-source';

/** private.guest_carta(slug) (0035). */
interface GuestCarta {
  restaurant: { name: string; slug: string; timezone: string | null; currency: string };
  settings: Omit<CartaSettings, 'openingHours'> & { openingHours: OpeningHours };
  dayparts: {
    id: string;
    name: string;
    nameEn: string | null;
    startsAt: string;
    endsAt: string;
    sortOrder: number;
    featuredDishId: string | null;
    categoryIds: string[];
  }[];
  deliveryFee: number | string;
  tipPercentage: number | string;
}

/** private.guest_table(slug, token) (0035). */
interface GuestTable {
  tableId: string;
  number: number;
  zoneName: string | null;
  isOpen: boolean;
}

interface GuestRows {
  carta: GuestCarta;
  menu: GuestMenuData;
  table: GuestTable | null;
}

const notFound = () => new NotFoundException(CARTA_MESSAGES.notFound);

/** Second guard after guest_carta's own field list: only the documented guest-safe settings leave the API. */
const guestSettings = (settings: GuestCarta['settings']): CartaSettings => ({
  description: settings.description,
  brandColor: settings.brandColor,
  logoUrl: settings.logoUrl,
  coverUrl: settings.coverUrl,
  instagram: settings.instagram,
  tiktok: settings.tiktok,
  whatsapp: settings.whatsapp,
  mapsUrl: settings.mapsUrl,
  googleReviewUrl: settings.googleReviewUrl,
  tableOrderingEnabled: settings.tableOrderingEnabled,
  deliveryOrderingEnabled: settings.deliveryOrderingEnabled,
  showTableBill: settings.showTableBill,
  englishEnabled: settings.englishEnabled,
  // guest_carta always returns the seven ISO days ("1".."7") or null (0035).
  openingHours: settings.openingHours as CartaSettings['openingHours'],
});

/** Sold-out dishes stay listed at the end of their category (S6). */
const soldOutLast = (dishes: MenuTreeDish[]) => [...dishes.filter((dish) => dish.available), ...dishes.filter((dish) => !dish.available)];

/**
 * The public carta (/c/<slug>, S1, S2): no login and no unit of work. The
 * restaurant comes only from the slug, and the table only from its token,
 * through the guest SECURITY DEFINER functions run on the pool without
 * app.user_id (the printer pattern). The menu is MenuService's own tree over
 * the guest rows, so the guest sees what the waiter sees for the channel.
 */
@Injectable()
export class CartaService {
  constructor(
    private readonly client: DbClient,
    private readonly clock: Clock,
    private readonly menu: MenuService,
  ) {}

  async carta(slug: string, channel: MenuChannel | undefined, lang: CartaLang | undefined, acceptLanguage?: string): Promise<Carta> {
    return this.build(await this.load(slug), channel ?? 'delivery', lang, acceptLanguage);
  }

  async table(slug: string, token: string, lang: CartaLang | undefined, acceptLanguage?: string): Promise<Carta> {
    if (!tableTokenSchema.safeParse(token).success) {
      throw notFound();
    }
    const rows = await this.load(slug, token);
    if (!rows.table) {
      throw notFound();
    }
    const { number, zoneName, isOpen } = rows.table;
    const table: CartaTable = { number, zoneName, isOpen };
    return { ...(await this.build(rows, 'dine_in', lang, acceptLanguage)), table };
  }

  /** Link preview of one dish the delivery menu lists (S9); sold out included. */
  async dish(slug: string, dishId: string): Promise<CartaDishShare> {
    if (!cartaDishIdSchema.safeParse(dishId).success) {
      throw notFound();
    }
    const rows = await this.load(slug);
    const tree = await this.tree(rows, 'delivery');
    const dish = [...tree.categories.flatMap((category) => category.dishes), ...tree.uncategorized].find((d) => d.id === dishId);
    if (!dish) {
      throw notFound();
    }
    return {
      restaurant: { name: rows.carta.restaurant.name, slug: rows.carta.restaurant.slug },
      dish: { id: dish.id, name: dish.name, description: dish.description, price: dish.price, imageUrl: dish.imageUrl },
    };
  }

  /** One statement, so the carta, the menu and the table read the same snapshot. */
  private async load(slug: string, token?: string): Promise<GuestRows> {
    if (!cartaSlugSchema.safeParse(slug).success) {
      throw notFound();
    }
    const { rows } = await this.client.pool.query<GuestRows>(
      `SELECT private.guest_carta($1) AS carta, private.guest_menu_data($1) AS menu,
              ${token === undefined ? 'NULL::jsonb' : 'private.guest_table($1, $2)'} AS table`,
      token === undefined ? [slug] : [slug, token],
    );
    const row = rows[0];
    if (!row?.carta || !row.menu) {
      throw notFound();
    }
    return row;
  }

  private now(rows: GuestRows) {
    return restaurantNow(this.clock.now(), rows.carta.restaurant.timezone ?? 'America/Bogota');
  }

  private tree(rows: GuestRows, channel: MenuChannel, now = this.now(rows)) {
    return this.menu.treeFrom(guestMenuSource(rows.menu, now), channel);
  }

  private async build(rows: GuestRows, channel: MenuChannel, query: CartaLang | undefined, acceptLanguage?: string): Promise<Carta> {
    const { carta, menu } = rows;
    const english = carta.settings.englishEnabled;
    const now = this.now(rows);
    const tree = await this.tree(rows, channel, now);
    const details = new Map(menu.details.map((detail) => [detail.dishId, detail]));
    const mostOrdered = new Set(menu.mostOrdered);
    const toDish = (dish: MenuTreeDish): CartaDish => {
      const detail = details.get(dish.id);
      return {
        id: dish.id,
        name: dish.name,
        description: dish.description,
        ...(english && detail?.descriptionEn ? { descriptionEn: detail.descriptionEn } : {}),
        price: dish.price,
        categoryId: dish.categoryId,
        subcategoryId: dish.subcategoryId,
        imageUrl: dish.imageUrl,
        allowComments: dish.allowComments,
        available: dish.available,
        tags: [...(detail?.tags ?? []), ...(mostOrdered.has(dish.id) ? ['most_ordered'] : [])],
        ...(dish.promotionId === undefined
          ? {}
          : {
              promotionId: dish.promotionId,
              promotionName: dish.promotionName,
              promotionBadge: dish.promotionBadge,
              promotionEndsAt: dish.promotionEndsAt,
              ...(dish.promoPrice === undefined ? {} : { promoPrice: dish.promoPrice }),
            }),
        modifierGroups: dish.modifierGroups.map((group) => ({
          id: group.id,
          name: group.name,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: group.options.map((option) => ({ id: option.id, name: option.name, price: option.price })),
        })),
      };
    };
    const guestMenu: CartaMenu = {
      categories: tree.categories.map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        icon: category.icon,
        color: category.color,
        hasSubcategories: category.hasSubcategories,
        subcategories: category.subcategories.map((subcategory) => ({ id: subcategory.id, name: subcategory.name })),
        dishes: soldOutLast(category.dishes).map(toDish),
      })),
      uncategorized: soldOutLast(tree.uncategorized).map(toDish),
    };
    const shownCategories = new Set(tree.categories.map((category) => category.id));
    const shownDishes = new Set([...tree.categories.flatMap((category) => category.dishes), ...tree.uncategorized].map((dish) => dish.id));
    const current = currentDaypartId(carta.dayparts, now.local);
    return {
      lang: resolveLang(query, acceptLanguage, english),
      channel,
      restaurant: { name: carta.restaurant.name, slug: carta.restaurant.slug, currency: carta.restaurant.currency },
      settings: guestSettings(carta.settings),
      ...openingState(carta.settings.openingHours, now.local),
      currentDaypartId: current,
      dayparts: carta.dayparts.map((daypart) => ({
        id: daypart.id,
        name: daypart.name,
        nameEn: english ? daypart.nameEn : null,
        startsAt: daypart.startsAt,
        endsAt: daypart.endsAt,
        current: daypart.id === current,
        featuredDishId: daypart.featuredDishId !== null && shownDishes.has(daypart.featuredDishId) ? daypart.featuredDishId : null,
        categoryIds: daypart.categoryIds.filter((id) => shownCategories.has(id)),
      })),
      menu: guestMenu,
      deliveryFee: Number(carta.deliveryFee),
      tipPercentage: Number(carta.tipPercentage),
    };
  }
}
