import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { Table } from '@/types';
import { BaseRepository } from './baseRepository';

export class TableRepository extends BaseRepository<Table> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'tables');
    }

    /**
     * Obtiene todas las mesas con la información del mesero asignado.
     * @returns Una promesa que resuelve a un array de mesas.
     */
    async getAllWithWaiterInfo(): Promise<Table[]> {
        try {
            const { data, error } = await this.supabase
                .from("tables")
                .select(
                    `
          *,
          profiles(id, full_name)
        `
                )
                .order("number");

            if (error) {
                throw error;
            }

            const tablesWithWaiterNames =
                data?.map((table) => ({
                    ...table,
                    waiter_name: table.profiles ? table.profiles.full_name : null,
                })) || [];

            return tablesWithWaiterNames as Table[];
        } catch (error) {
            this.handleError(error, "Error fetching tables with waiter info:");
        }
    }

    /**
     * Obtiene una mesa por su ID con la información del mesero asignado.
     * @param id El ID de la mesa.
     * @returns Una promesa que resuelve a la mesa o null si no se encuentra.
     */
    async getByIdWithWaiterInfo(id: string): Promise<Table | null> {
        try {
            const { data, error } = await this.supabase
                .from("tables")
                .select(
                    `
          *,
          profiles(id, full_name)
        `
                )
                .eq("id", id)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (!data) return null;

            return {
                ...data,
            } as Table;
        } catch (error) {
            this.handleError(error, "Error fetching table by ID with waiter info:");
        }
    }

    /**
     * Elimina una mesa.
     * @param id El ID de la mesa a eliminar.
     * @returns Una promesa que resuelve a true si la eliminación fue exitosa.
     * @throws Error si la mesa tiene órdenes activas.
     */
    async deleteTable(id: string): Promise<boolean> {
        try {
            console.log("Attempting to delete table with ID:", id);

            const { data: activeOrders, error: ordersError } = await this.supabase
                .from("orders")
                .select("id")
                .eq("table_id", id)
                .neq("status", "paid");

            if (ordersError) {
                throw ordersError;
            }

            if (activeOrders && activeOrders.length > 0) {
                throw new Error("No se puede eliminar una mesa con órdenes activas.");
            }

            const { error } = await this.supabase.from("tables").delete().eq("id", id);

            if (error) {
                throw error;
            }

            console.log("Table deleted successfully.");
            return true;
        } catch (error) {
            this.handleError(error, "Error deleting table:");
        }
    }

    /**
     * Asigna un mesero a una mesa y actualiza su estado.
     * @param tableId El ID de la mesa.
     * @param waiterId El ID del mesero.
     * @param status El nuevo estado de la mesa (por defecto "reserved").
     * @returns Una promesa que resuelve a la mesa actualizada.
     */
    async assignWaiter(tableId: string, waiterId: string, status = "reserved"): Promise<Table> {
        try {
            const { data, error } = await this.supabase
                .from("tables")
                .update({
                    waiter_id: waiterId,
                    status: status,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", tableId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            return data as Table;
        } catch (error) {
            this.handleError(error, "Error assigning waiter to table:");
        }
    }

    /**
     * Actualiza el estado de una mesa. Si el estado es "available", desasigna el mesero.
     * @param tableId El ID de la mesa.
     * @param status El nuevo estado de la mesa.
     * @returns Una promesa que resuelve a la mesa actualizada.
     */
    async updateTableStatus(tableId: string, status: string): Promise<Table> {
        const updates: any = {
            status: status,
            updated_at: new Date().toISOString(),
        };

        if (status === "available") {
            updates["waiter_id"] = null;
        }

        try {
            const { data, error } = await this.supabase
                .from("tables")
                .update(updates)
                .eq("id", tableId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log(`Table ${tableId} updated to status ${status}`, data);
            return data as Table;
        } catch (error) {
            this.handleError(error, "Error updating table status:");
        }
    }

    /**
     * Libera una mesa, estableciendo su estado a "available" y desasignando cualquier mesero.
     * @param tableId El ID de la mesa a liberar.
     * @returns Una promesa que resuelve a la mesa actualizada.
     */
    async releaseTable(tableId: string): Promise<Table> {
        console.log(`Releasing table ${tableId}...`);
        try {
            const { data, error } = await this.supabase
                .from("tables")
                .update({
                    waiter_id: null,
                    status: "available",
                    updated_at: new Date().toISOString(),
                })
                .eq("id", tableId)
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log(`Table ${tableId} released successfully`, data);
            return data as Table;
        } catch (error) {
            this.handleError(error, "Error releasing table:");
        }
    }
}