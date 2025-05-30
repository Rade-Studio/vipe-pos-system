import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { IngredientTransaction } from '@/types';
import { BaseRepository } from './baseRepository';

export class IngredientTransactionRepository extends BaseRepository<IngredientTransaction> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'ingredient_transactions');
    }

    /**
     * Obtiene todas las transacciones de ingredientes con los detalles del ingrediente.
     * @returns Una promesa que resuelve a un array de transacciones.
     */
    async getAllWithIngredientDetails(): Promise<IngredientTransaction[]> {
        try {
            const { data, error } = await this.supabase
                .from('ingredient_transactions')
                .select(`*, ingredients(name, unit)`)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []).map(transaction => ({
                ...transaction,
                ingredient_name: transaction.ingredients?.name || 'Unknown',
                ingredient_unit: transaction.ingredients?.unit || 'unit',
            })) as IngredientTransaction[];
        } catch (error) {
            this.handleError(error, 'Error fetching ingredient transactions with details:');
        }
    }

    /**
     * Obtiene las transacciones de ingredientes por un rango de fechas.
     * @param startDate La fecha de inicio.
     * @param endDate La fecha de fin.
     * @returns Una promesa que resuelve a un array de transacciones.
     */
    async getTransactionsByDateRange(startDate: Date, endDate: Date): Promise<IngredientTransaction[]> {
        const startOfDay = new Date(startDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);

        try {
            const { data, error } = await this.supabase
                .from('ingredient_transactions')
                .select(`*, ingredients(name, unit)`)
                .gte('created_at', startOfDay.toISOString())
                .lte('created_at', endOfDay.toISOString())
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []).map(transaction => ({
                ...transaction,
                ingredient_name: transaction.ingredients?.name || 'Unknown',
                ingredient_unit: transaction.ingredients?.unit || 'unit',
            })) as IngredientTransaction[];
        } catch (error) {
            this.handleError(error, 'Error fetching ingredient transactions by date range:');
        }
    }

    /**
     * Registra una transacción de ingrediente y actualiza el stock del ingrediente.
     * @param transaction Los datos de la transacción a crear.
     * @returns Una promesa que resuelve a la transacción creada.
     */
    async recordTransactionAndUpdateStock(transaction: {
        ingredient_id: string;
        type: 'add' | 'remove';
        quantity: number;
        reason: string;
        responsible_user_id: string;
    }): Promise<IngredientTransaction> {
        const { ingredient_id, type, quantity, reason, responsible_user_id } = transaction;

        const { data: ingredient, error: fetchError } = await this.supabase
            .from('ingredients')
            .select('stock')
            .eq('id', ingredient_id)
            .single();

        if (fetchError || !ingredient) {
            this.handleError(fetchError, `Error fetching ingredient stock for ID ${ingredient_id}:`);
        }

        let newStock = ingredient.stock;
        if (type === 'add') {
            newStock += quantity;
        } else if (type === 'remove') {
            newStock -= quantity;
        }

        if (newStock < 0) {
            throw new Error('Stock cannot be negative.');
        }

        const { data: updatedIngredient, error: updateError } = await this.supabase
            .from('ingredients')
            .update({ stock: newStock })
            .eq('id', ingredient_id)
            .select()
            .single();

        if (updateError) {
            this.handleError(updateError, `Error updating ingredient stock for ID ${ingredient_id}:`);
        }

        const { data: newTransaction, error: transactionError } = await this.supabase
            .from('ingredient_transactions')
            .insert({
                ingredient_id,
                type,
                quantity,
                new_stock: newStock,
                reason,
                responsible_user_id,
            })
            .select()
            .single();

        if (transactionError) {
            this.handleError(transactionError, 'Error recording ingredient transaction:');
        }

        return newTransaction as IngredientTransaction;
    }
}