import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { Ingredient } from '@/types';
import { BaseRepository } from './baseRepository';

export class IngredientRepository extends BaseRepository<Ingredient> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'ingredients');
    }

    /**
     * Obtiene todos los ingredientes con su categoría.
     * @returns Una promesa que resuelve a un array de ingredientes.
     */
    async getAllWithCategory(): Promise<Ingredient[]> {
        try {
            const { data: ingredients, error: ingError } = await this.supabase
                .from("ingredients")
                .select(
                    `
          *,
          ingredient_categories(id, name)
        `
                )
                .order("name");

            if (ingError) {
                throw ingError;
            }

            return (ingredients || []).map((ingredient) => {
                return {
                    ...ingredient,
                    category: ingredient.ingredient_categories
                        ? ingredient.ingredient_categories.name
                        : "Sin categoría",
                    category_id: ingredient.category_id,
                } as Ingredient; // Asegúrate de que el tipo sea correcto
            });
        } catch (error) {
            this.handleError(error, "Error fetching ingredients with category:");
        }
    }

    /**
     * Obtiene un ingrediente por su ID con su categoría.
     * @param id El ID del ingrediente.
     * @returns Una promesa que resuelve al ingrediente o null si no se encuentra.
     */
    async getByIdWithCategory(id: string): Promise<Ingredient | null> {
        try {
            const { data: ingredient, error: ingError } = await this.supabase
                .from("ingredients")
                .select(
                    `
          *,
          ingredient_categories(id, name)
        `
                )
                .eq("id", id)
                .single();

            if (ingError && ingError.code !== 'PGRST116') {
                throw ingError;
            }

            if (!ingredient) return null;

            return {
                ...ingredient,
                category: ingredient.ingredient_categories
                    ? ingredient.ingredient_categories.name
                    : "Sin categoría",
                category_id: ingredient.category_id,
            } as Ingredient;
        } catch (error) {
            this.handleError(error, "Error fetching ingredient by ID with category:");
        }
    }
}