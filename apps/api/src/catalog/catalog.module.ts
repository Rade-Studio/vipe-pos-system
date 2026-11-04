import { Module } from '@nestjs/common';
import { CategoriesController, DishesController, PromotionsController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { DishesService } from './dishes.service';
import { PromotionsService } from './promotions.service';

@Module({
  controllers: [CategoriesController, DishesController, PromotionsController],
  providers: [CategoriesService, DishesService, PromotionsService],
})
export class CatalogModule {}
