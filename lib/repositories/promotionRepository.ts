import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import {Dish, Promotion} from '@/types';
import { BaseRepository } from './baseRepository';

export class PromotionRepository extends BaseRepository<Promotion> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'promotions');
    }

    /**
     * Obtiene todas las promociones con los platos asociados.
     * @returns Una promesa que resuelve a un array de promociones.
     */
    async getAllWithDishes(): Promise<Promotion[]> {
        try {
            const { data, error } = await this.supabase
                .from('promotions')
                .select(`*, promotion_dishes(dish_id, dishes(name))`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            return (data || []).map(promo => ({
                ...promo,
                promotion_dishes: promo.promotion_dishes.map((pd: any) => ({
                    dish_id: pd.dish_id,
                    dish_name: pd.dishes?.name
                }))
            })) as Promotion[];
        } catch (error) {
            this.handleError(error, 'Error fetching promotions with dishes:');
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
     * Asigna platos a una promoción, eliminando asignaciones anteriores.
     * @param promotionId El ID de la promoción.
     * @param dishIds Array de IDs de platos a asignar.
     * @returns Una promesa que resuelve a true si la operación fue exitosa.
     */
    async assignDishesToPromotion(promotionId: string, dishIds: string[]): Promise<boolean> {
        try {
            // Eliminar asignaciones existentes para esta promoción
            const { error: deleteError } = await this.supabase
                .from("promotion_dishes")
                .delete()
                .eq("promotion_id", promotionId);

            if (deleteError) throw deleteError;

            // Si no hay platos para asignar, terminar
            if (dishIds.length === 0) return true;

            // Crear nuevas asignaciones
            const promotionDishes = dishIds.map((dishId) => ({
                promotion_id: promotionId,
                dish_id: dishId,
            }));

            const { error: insertError } = await this.supabase
                .from("promotion_dishes")
                .insert(promotionDishes);

            if (insertError) throw insertError;
            return true;
        } catch (error) {
            this.handleError(error, `Error assigning dishes to promotion ${promotionId}:`);
        }
    }

    /**
     * Obtiene los platos asignados a una promoción.
     * @param promotionId El ID de la promoción.
     * @returns Una promesa que resuelve a un array de objetos de platos.
     */
    async getPromotionDishes(promotionId: string): Promise<Dish[]> {
        try {
            const { data, error } = await this.supabase
                .from("promotion_dishes")
                .select("dishes(*)")
                .eq("promotion_id", promotionId);

            if (error) throw error;
            return data?.map((item) => item.dishes) as unknown as Dish[] || [];
        } catch (error) {
            this.handleError(error, "Error getting promotion dishes:");
        }
    }

    /**
     * Elimina una promoción y todas sus asignaciones de platos.
     * @param id El ID de la promoción a eliminar.
     * @returns Una promesa que resuelve a true si la eliminación fue exitosa.
     */
    async deletePromotionAndDishes(id: string): Promise<boolean> {
        try {
            // Primero eliminar las relaciones con platos
            const { error: promotionDishesError } = await this.supabase.from("promotion_dishes").delete().eq("promotion_id", id);
            if (promotionDishesError) throw promotionDishesError;

            // Luego eliminar la promoción
            const { error } = await this.supabase.from("promotions").delete().eq("id", id);
            if (error) throw error;
            return true;
        } catch (error) {
            this.handleError(error, "Error deleting promotion and its dishes:");
        }
    }
}
