import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { Recipe, RecipeIngredient } from '@/types';
import { BaseRepository } from './baseRepository';

export class RecipeRepository extends BaseRepository<Recipe> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'recipes');
    }

    /**
     * Obtiene una receta por el ID del plato.
     * @param dishId El ID del plato.
     * @returns Una promesa que resuelve a la receta o null si no se encuentra.
     */
    async getByDishId(dishId: string): Promise<Recipe | null> {
        try {
            const { data, error } = await this.supabase
                .from("recipes")
                .select("*")
                .eq("dish_id", dishId)
                .single();

            if (error && error.code === "PGRST116") {
                return null;
            }
            if (error) throw error;
            return data as Recipe;
        } catch (error) {
            this.handleError(error, "Error fetching recipe by dish ID:");
        }
    }

    /**
     * Obtiene los ingredientes de una receta específica.
     * @param recipeId El ID de la receta.
     * @returns Una promesa que resuelve a un array de ingredientes de la receta.
     */
    async getRecipeIngredients(recipeId: string): Promise<RecipeIngredient[]> {
        try {
            const { data, error } = await this.supabase
                .from("recipe_ingredients")
                .select(
                    `
          *,
          ingredients (name, unit)
        `
                )
                .eq("recipe_id", recipeId);

            if (error) throw error;

            return (data || []).map((item) => ({
                id: item.id,
                recipe_id: item.recipe_id, // Usar recipe_id para consistencia
                ingredient_id: item.ingredient_id,
                quantity: item.quantity,
                created_at: item.created_at,
                ingredient: item.ingredients
                    ? {
                        name: item.ingredients.name,
                        unit: item.ingredients.unit,
                    }
                    : undefined,
            })) as RecipeIngredient[];
        } catch (error) {
            this.handleError(error, "Error fetching recipe ingredients:");
        }
    }

    /**
     * Añade un ingrediente a una receta.
     * @param recipeIngredient Los datos del ingrediente de la receta a añadir.
     * @returns Una promesa que resuelve al ingrediente de la receta añadido.
     */
    async addIngredientToRecipe(recipeIngredient: {
        recipe_id: string; // Usar recipe_id
        ingredient_id: string;
        quantity: number;
    }): Promise<RecipeIngredient> {
        try {
            const { data, error } = await this.supabase
                .from("recipe_ingredients")
                .insert([
                    {
                        recipe_id: recipeIngredient.recipe_id,
                        ingredient_id: recipeIngredient.ingredient_id,
                        quantity: recipeIngredient.quantity,
                        created_at: new Date().toISOString(),
                    },
                ])
                .select()
                .single();

            if (error) throw error;
            return data as RecipeIngredient;
        } catch (error) {
            this.handleError(error, "Error adding ingredient to recipe:");
        }
    }

    /**
     * Actualiza la cantidad de un ingrediente en una receta.
     * @param id El ID del registro de ingrediente en la receta.
     * @param updates Los datos de actualización (solo la cantidad).
     * @returns Una promesa que resuelve al ingrediente de la receta actualizado.
     */
    async updateRecipeIngredient(id: string, updates: { quantity: number }): Promise<RecipeIngredient> {
        try {
            const { data, error } = await this.supabase
                .from("recipe_ingredients")
                .update({
                    quantity: updates.quantity,
                })
                .eq("id", id)
                .select()
                .single();

            if (error) throw error;
            return data as RecipeIngredient;
        } catch (error) {
            this.handleError(error, "Error updating recipe ingredient:");
        }
    }

    /**
     * Elimina un ingrediente de una receta.
     * @param recipeIngredientId El ID del registro de ingrediente en la receta a eliminar.
     * @returns Una promesa que resuelve a true si la eliminación fue exitosa.
     */
    async removeIngredientFromRecipe(recipeIngredientId: string): Promise<boolean> {
        try {
            const { error } = await this.supabase
                .from("recipe_ingredients")
                .delete()
                .eq("id", recipeIngredientId);

            if (error) throw error;
            return true;
        } catch (error) {
            this.handleError(error, "Error removing ingredient from recipe:");
        }
    }

    /**
     * Elimina una receta y todos sus ingredientes asociados.
     * @param recipeId El ID de la receta a eliminar.
     * @returns Una promesa que resuelve a true si la eliminación fue exitosa.
     */
    async deleteRecipeAndIngredients(recipeId: string): Promise<boolean> {
        try {
            const { error: ingredientsError } = await this.supabase
                .from("recipe_ingredients")
                .delete()
                .eq("recipe_id", recipeId);

            if (ingredientsError) throw ingredientsError;

            const { error } = await this.supabase.from("recipes").delete().eq("id", recipeId);

            if (error) throw error;
            return true;
        } catch (error) {
            this.handleError(error, "Error deleting recipe and its ingredients:");
        }
    }
}