import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersService } from '../orders/orders.service';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { CartaInboxController } from './carta-inbox.controller';
import { CartaInboxService } from './carta-inbox.service';
import { CartaTableController } from './carta-table.controller';
import { CartaTableService } from './carta-table.service';
import { CartaController } from './carta.controller';
import { CartaService } from './carta.service';
import { RateLimitGuard, rateLimiterProvider } from './rate-limit';

/**
 * Public digital menu (carta-digital T2): read-only, no login, rate-limited.
 * Table QR orders (T4b): guest endpoints on the pool and the staff inbox,
 * whose confirm adds the items with the waiter's OrdersService (OrdersModule
 * does not export it, so it is provided here with the same imports).
 */
@Module({
  imports: [CatalogModule, SettingsModule, AuditModule, PromotionsModule],
  controllers: [CartaController, CartaTableController, CartaInboxController],
  providers: [CartaService, CartaTableService, CartaInboxService, OrdersService, RateLimitGuard, rateLimiterProvider],
})
export class CartaModule {}
