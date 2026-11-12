import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { SettingsModule } from '../settings/settings.module';
import { ManualDiscountsService } from './manual-discounts.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [SettingsModule, CatalogModule, AuditModule, AuthModule, PromotionsModule],
  controllers: [OrdersController],
  providers: [OrdersService, ManualDiscountsService],
})
export class OrdersModule {}
