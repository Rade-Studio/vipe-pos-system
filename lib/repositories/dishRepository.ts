import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { Dish, Promotion } from '@/types';
import { BaseRepository } from './baseRepository';
import { calculateDiscount } from '@/utils/helpers'; // Importar la función de utilidad

export class DishRepository extends BaseRepository<Dish> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'dishes');
    }

    /**
     * Obtiene todos los platos con su categoría.
     * @returns Una promesa que resuelve a un array de platos.
     */
    async getAllWithCategory(): Promise<Dish[]> {
        try {
            const { data, error } = await this.supabase
                .from("dishes")
                .select("*, categories(name)")
                .order("name");
            if (error) throw error;
            return data as Dish[];
        } catch (error) {
            this.handleError(error, "Error fetching dishes with category:");
        }
    }

    /**
     * Obtiene platos por categoría.
     * @param categoryId El ID de la categoría.
     * @returns Una promesa que resuelve a un array de platos de la categoría.
     */
    async getByCategory(categoryId: string): Promise<Dish[]> {
        try {
            const { data, error } = await this.supabase
                .from("dishes")
                .select("*")
                .eq("category_id", categoryId)
                .eq("active", true)
                .order("name");
            if (error) throw error;
            return data as Dish[];
        } catch (error) {
            this.handleError(error, "Error fetching dishes by category:");
        }
    }

    /**
     * Obtiene todas las promociones activas.
     * @returns Una promesa que resuelve a un array de promociones activas.
     */
    async getActivePromotions(): Promise<Promotion[]> {
        try {
            const { data, error } = await this.supabase
                .from("promotions")
                .select("*")
                .eq("active", true)
                .lte("start_date", new Date().toISOString())
                .gte("end_date", new Date().toISOString());

            if (error) throw error;
            return data as Promotion[] || [];
        } catch (error) {
            this.handleError(error, "Error getting active promotions:");
        }
    }

    /**
     * Obtiene la relación entre promociones y platos.
     * @returns Una promesa que resuelve a un array de objetos promotion_dishes.
     */
    private async getPromotionDishesRelationships(): Promise<{ promotion_id: string; dish_id: string }[]> {
        try {
            const { data, error } = await this.supabase.from("promotion_dishes").select("*");
            if (error) throw error;
            return data || [];
        } catch (error) {
            this.handleError(error, "Error fetching promotion_dishes relationships:");
        }
    }

    /**
     * Aplica la lógica de promociones a una lista de platos.
     * @param dishes Los platos a los que se aplicarán las promociones.
     * @param activePromotions Las promociones activas.
     * @param promotionDishes La relación entre promociones y platos.
     * @returns Un array de platos con las promociones aplicadas.
     */
    private applyPromotionsToDishes(
        dishes: Dish[],
        activePromotions: Promotion[],
        promotionDishes: { promotion_id: string; dish_id: string }[]
    ): Dish[] {
        return dishes.map((dish) => {
            const applicablePromotionIds = promotionDishes
                .filter((pd) => pd.dish_id === dish.id.toString())
                .map((pd) => pd.promotion_id);

            let bestPromotion: Promotion | null = null;
            let maxDiscount = 0;

            for (const promotionId of applicablePromotionIds) {
                const promotion = activePromotions.find((p) => p.id === promotionId);
                if (promotion) {
                    const discount = calculateDiscount(dish.price, promotion);
                    if (discount > maxDiscount) {
                        maxDiscount = discount;
                        bestPromotion = promotion;
                    }
                }
            }

            if (bestPromotion) {
                const discountAmount = calculateDiscount(dish.price, bestPromotion);
                return {
                    ...dish,
                    originalPrice: dish.price,
                    price: dish.price - discountAmount,
                    discountAmount,
                    discountPercentage: bestPromotion.discount_type === "percentage" ? bestPromotion.discount_value : null,
                    promotionId: bestPromotion.id,
                    promotionName: bestPromotion.name,
                } as Dish;
            }

            return dish;
        });
    }

    /**
     * Obtiene todos los platos con sus promociones aplicadas.
     * @returns Una promesa que resuelve a un array de platos con promociones.
     */
    async getAllWithPromotions(): Promise<Dish[]> {
        try {
            const [dishes, activePromotions, promotionDishes] = await Promise.all([
                this.supabase.from("dishes").select("*").order("name").then(res => {
                    if (res.error) throw res.error;
                    return res.data;
                }),
                this.getActivePromotions(),
                this.getPromotionDishesRelationships(),
            ]);

            return this.applyPromotionsToDishes(dishes as Dish[], activePromotions, promotionDishes);
        } catch (error) {
            this.handleError(error, "Error getting dishes with promotions:");
        }
    }

    /**
     * Obtiene platos por categoría con promociones aplicadas.
     * @param categoryId El ID de la categoría.
     * @returns Una promesa que resuelve a un array de platos de la categoría con promociones.
     */
    async getByCategoryWithPromotions(categoryId: string): Promise<Dish[]> {
        try {
            const [dishes, activePromotions, promotionDishes] = await Promise.all([
                this.supabase
                    .from("dishes")
                    .select("*")
                    .eq("category_id", categoryId)
                    .eq("active", true)
                    .order("name").then(res => {
                    if (res.error) throw res.error;
                    return res.data;
                }),
                this.getActivePromotions(),
                this.getPromotionDishesRelationships(),
            ]);

            return this.applyPromotionsToDishes(dishes as Dish[], activePromotions, promotionDishes);
        } catch (error) {
            this.handleError(error, "Error getting dishes by category with promotions:");
        }
    }
}
