import { Module } from '@nestjs/common';
import { SalesService } from '../inventory/sales.service';
import {
  CategoriesController,
  DishesController,
  MenuController,
  PromotionsController,
  SubcategoriesController,
} from './catalog.controller';
import { CategoriesService } from './categories.service';
import { DishesService } from './dishes.service';
import { MenuService } from './menu.service';
import { PromotionsService } from './promotions.service';
import { SubcategoriesService } from './subcategories.service';

// SalesService (the availability rule) is stateless over the request
// UnitOfWork; providing it here rather than importing InventoryModule keeps the
// module init order, and with it the OpenAPI path order, unchanged.
@Module({
  controllers: [CategoriesController, DishesController, PromotionsController, SubcategoriesController, MenuController],
  providers: [CategoriesService, SubcategoriesService, DishesService, PromotionsService, MenuService, SalesService],
  exports: [DishesService],
})
export class CatalogModule {}
