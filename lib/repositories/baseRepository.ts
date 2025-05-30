import { SupabaseClient } from '@supabase/supabase-js';
import {Database, Tables} from '@/types/supabase.types'; // Importar Database para el tipo de cliente

/**
 * Clase base genérica para interactuar con tablas de Supabase.
 * Proporciona métodos CRUD comunes.
 */
export class BaseRepository<T> {
    protected supabase: SupabaseClient<Database>; // Usar Database para el tipo de cliente
    protected tableName: keyof Database["public"]["Tables"];

    constructor(supabase: SupabaseClient<Database>, tableName: keyof Database["public"]["Tables"]) {
        this.supabase = supabase;
        this.tableName = tableName;
    }

    /**
     * Obtiene todos los registros de la tabla.
     * @param selectColumns Columnas a seleccionar (por defecto '*').
     * @param orderBy Columna por la que ordenar.
     * @param ascending Si el orden es ascendente (por defecto true).
     * @returns Una promesa que resuelve a un array de tipo T.
     */
    async getAll(selectColumns: string = '*', orderBy?: string, ascending: boolean = true): Promise<T[]> {
        try {
            let query = this.supabase.from(this.tableName).select(selectColumns);
            if (orderBy) {
                query = query.order(orderBy, { ascending });
            }
            const { data, error } = await query;
            if (error) throw error;
            return data as T[] || [];
        } catch (error) {
            console.error(`Error fetching all from ${this.tableName}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene un registro por su ID.
     * @param id El ID del registro.
     * @param selectColumns Columnas a seleccionar (por defecto '*').
     * @returns Una promesa que resuelve al registro o null si no se encuentra.
     */
    async getById(id: string, selectColumns: string = '*'): Promise<T | null> {
        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select(selectColumns)
                .eq("id", id)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
                throw "No se encontró el registro.";
            }
            return data as T | null;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Crea un nuevo registro.
     * @param payload Los datos del registro a crear.
     * @returns Una promesa que resuelve al registro creado.
     */
    async create(payload: Partial<T>): Promise<T> {
        try {
            const {data, error} = await this.supabase
                .from(this.tableName)
                .insert([payload])
                .select().single();
            if (error) throw error;
            return data as T;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Actualiza un registro existente.
     * @param id El ID del registro a actualizar.
     * @param payload Los datos parciales del registro a actualizar.
     * @returns Una promesa que resuelve al registro actualizado.
     */
    async update(id: string, payload: Partial<T>): Promise<T> {
        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .update({ ...payload, updated_at: new Date().toISOString() }) // Asume que updated_at es una columna común
                .eq("id", id)
                .select()
                .single();
            if (error) throw error;
            return data as T;
        } catch (error) {
            console.error(`Error updating ${this.tableName} with ID (${id}):`, error);
            throw error;
        }
    }

    /**
     * Elimina un registro.
     * @param id El ID del registro a eliminar.
     * @returns Una promesa que resuelve a true si la eliminación fue exitosa.
     */
    async delete(id: string): Promise<boolean> {
        try {
            const { error } = await this.supabase.from(this.tableName).delete().eq("id", id);
            if (error) throw error;
            return true;
        } catch (error) {
            console.error(`Error deleting ${this.tableName} with ID (${id}):`, error);
            throw error;
        }
    }

    /**
     * Maneja y registra errores.
     * @param error El objeto de error.
     * @param message El mensaje de error descriptivo.
     */
    protected handleError(error: any, message: string): never {
        console.error(message, error);
        throw error;
    }
}
