import { Injectable } from '@nestjs/common';
import { SalesService } from '../inventory/sales.service';
import type { MenuTree } from './catalog.dto';
import { CategoriesService } from './categories.service';
import { DishesService } from './dishes.service';
import { SubcategoriesService } from './subcategories.service';

/**
 * The waiter and delivery step picker's one read (S5, S3): active categories,
 * their active subcategories and active dishes. Pricing and availability are
 * the existing rules: DishesService with `pricing: 'promotions'` and
 * SalesService.availability (check_dishes_stock).
 */
@Injectable()
export class MenuService {
  constructor(
    private readonly categories: CategoriesService,
    private readonly subcategories: SubcategoriesService,
    private readonly dishes: DishesService,
    private readonly sales: SalesService,
  ) {}

  async tree(): Promise<MenuTree> {
    const categories = await this.categories.list(true);
    const subcategories = await this.subcategories.list({ includeInactive: false });
    const activeSubcategories = new Set(subcategories.map((subcategory) => subcategory.id));
    // A dish of an inactive subcategory would have no tile to sit under.
    const dishes = (await this.dishes.list({ active: true, pricing: 'promotions' })).filter(
      (dish) => dish.subcategoryId === null || activeSubcategories.has(dish.subcategoryId),
    );
    const available = await this.sales.availability(dishes.map((dish) => dish.id));
    return {
      categories: categories.map((category) => ({
        ...category,
        subcategories: subcategories.filter((subcategory) => subcategory.categoryId === category.id),
        dishes: dishes
          .filter((dish) => dish.categoryId === category.id)
          .map((dish) => ({ ...dish, available: available[dish.id] ?? false })),
      })),
    };
  }
}
