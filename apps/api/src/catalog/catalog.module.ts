import { Module } from '@nestjs/common';
import { SalesService } from '../inventory/sales.service';
import { PromotionsModule } from '../promotions/promotions.module';
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
import { ModifierGroupsController, ModifierOptionsController } from './modifiers.controller';
import { ModifiersService } from './modifiers.service';
import { PromotionsService } from './promotions.service';
import { SubcategoriesService } from './subcategories.service';

// SalesService (the availability rule) is stateless over the request
// UnitOfWork; providing it here rather than importing InventoryModule keeps the
// module init order, and with it the OpenAPI path order, unchanged.
@Module({
  imports: [PromotionsModule],
  controllers: [
    CategoriesController,
    DishesController,
    PromotionsController,
    SubcategoriesController,
    MenuController,
    ModifierGroupsController,
    ModifierOptionsController,
  ],
  providers: [CategoriesService, SubcategoriesService, DishesService, PromotionsService, MenuService, SalesService, ModifiersService],
  exports: [DishesService, PromotionsService],
})
export class CatalogModule {}
