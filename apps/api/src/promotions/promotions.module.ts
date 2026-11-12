import { Module } from '@nestjs/common';
import { OrderDiscountsService } from './order-discounts.service';
import { PromotionCatalog } from './promotion-catalog.service';

/**
 * Promotion wiring over the pure engine (promociones T3): the loader in the
 * engine shape with the restaurant clock, and the order discount recompute.
 * No controllers (the CRUD lives in catalog), so the OpenAPI path order holds.
 */
@Module({
  providers: [PromotionCatalog, OrderDiscountsService],
  exports: [PromotionCatalog, OrderDiscountsService],
})
export class PromotionsModule {}
