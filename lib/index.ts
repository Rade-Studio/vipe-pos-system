import { supabase } from './client';
import { CategoryRepository } from './repositories/categoryRepository';
import { DishRepository } from './repositories/dishRepository';
import { IngredientCategoryRepository } from './repositories/ingredientCategoryRepository';
import { IngredientRepository } from './repositories/ingredientRepository';
import { IngredientTransactionRepository } from './repositories/ingredientTransactionRepository';
import { OrderRepository } from './repositories/orderRepository';
import { ProfileRepository } from './repositories/profileRepository';
import { PromotionRepository } from './repositories/promotionRepository';
import { RecipeRepository } from './repositories/recipeRepository';
import { TableRepository } from './repositories/tableRepository';
import { CashRegisterRepository } from './repositories/cashRegisterRepository';
// import { BusinessConfigRepository } from './repositories/businessConfigRepository'; // Si lo implementas
// import { PaymentRepository } from './repositories/paymentRepository'; // Si lo implementas
// import { RealtimeService } from './realtime-service'; // Si lo refactorizas a un repositorio

// Instanciar los repositorios
export const categoryRepository = new CategoryRepository(supabase);
export const dishRepository = new DishRepository(supabase);
export const ingredientCategoryRepository = new IngredientCategoryRepository(supabase);
export const ingredientRepository = new IngredientRepository(supabase);
export const ingredientTransactionRepository = new IngredientTransactionRepository(supabase);
export const orderRepository = new OrderRepository(supabase);
export const profileRepository = new ProfileRepository(supabase);
export const promotionRepository = new PromotionRepository(supabase);
export const recipeRepository = new RecipeRepository(supabase);
export const tableRepository = new TableRepository(supabase);
export const cashRegisterRepository = new CashRegisterRepository(supabase);
// export const businessConfigRepository = new BusinessConfigRepository(supabase);
// export const paymentRepository = new PaymentRepository(supabase);
// export const realtimeService = new RealtimeService(supabase); // Mantenerlo si no es un CRUD típico

// Exportar todos los repositorios bajo un solo objeto 'repositories'
export const repositories = {
    categories: categoryRepository,
    dishes: dishRepository,
    ingredientCategories: ingredientCategoryRepository,
    ingredients: ingredientRepository,
    ingredientTransactions: ingredientTransactionRepository,
    orders: orderRepository,
    profiles: profileRepository,
    promotions: promotionRepository,
    recipes: recipeRepository,
    tables: tableRepository,
    cashRegisters: cashRegisterRepository,
    // businessConfig: businessConfigRepository,
    // payments: paymentRepository,
    // realtime: realtimeService,
};
