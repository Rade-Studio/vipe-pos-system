import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DeliveryService } from '../delivery/delivery.service';
import { InventoryModule } from '../inventory/inventory.module';
import { OrdersService } from '../orders/orders.service';
import { PrintModule } from '../print/print.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { StorageService } from '../storage/storage.service';
import { CartaAdminController } from './carta-admin.controller';
import { CartaAdminService } from './carta-admin.service';
import { CartaDeliveryInboxController } from './carta-delivery-inbox.controller';
import { CartaDeliveryInboxService } from './carta-delivery-inbox.service';
import { CartaDeliveryController } from './carta-delivery.controller';
import { CartaDeliveryService } from './carta-delivery.service';
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
 * Delivery (T6): guest requests and pricing on the pool, and the operators'
 * inbox, whose confirm creates the order with the console's DeliveryService
 * (DeliveryModule does not export it either: same approach).
 * Admin settings (T8): the logo and cover upload through StorageService,
 * provided here too (StorageModule does not export it).
 */
@Module({
  imports: [CatalogModule, SettingsModule, AuditModule, PromotionsModule, InventoryModule, PrintModule],
  controllers: [CartaController, CartaTableController, CartaInboxController, CartaDeliveryController, CartaDeliveryInboxController, CartaAdminController],
  providers: [
    CartaService,
    CartaTableService,
    CartaInboxService,
    CartaDeliveryService,
    CartaDeliveryInboxService,
    CartaAdminService,
    OrdersService,
    DeliveryService,
    StorageService,
    RateLimitGuard,
    rateLimiterProvider,
  ],
})
export class CartaModule {}
