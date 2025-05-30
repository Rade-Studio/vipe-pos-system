import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { Category } from '@/types'; // Asume que Category es un tipo en models.ts
import { BaseRepository } from './baseRepository';

export class CategoryRepository extends BaseRepository<Category> {
    constructor(supabase: SupabaseClient<Database>) {
        super(supabase, 'categories');
    }

    // Puedes añadir métodos específicos para categorías aquí si los necesitas.
    // Por ejemplo, un método para obtener categorías con platos asociados:
    // async getAllWithDishes(): Promise<Category[]> {
    //   try {
    //     const { data, error } = await this.supabase
    //       .from('categories')
    //       .select('*, dishes(*)')
    //       .order('name');
    //     if (error) throw error;
    //     return data as Category[];
    //   } catch (error) {
    //     this.handleError(error, 'Error fetching categories with dishes:');
    //   }
    // }
}