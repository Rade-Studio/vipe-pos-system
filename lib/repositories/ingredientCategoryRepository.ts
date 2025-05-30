import { SupabaseClient } from '@supabase/supabase-js';
import { Database } from '@/types/supabase.types';
import { IngredientCategory } from '@/types';
import { BaseRepository } from './baseRepository';

export class IngredientCategoryRepository extends BaseRepository<IngredientCategory> {
  constructor(supabase: SupabaseClient<Database>) {
    super(supabase, 'ingredient_categories');
  }

  // Métodos específicos si los necesitas, de lo contrario, usa los de BaseRepository
}