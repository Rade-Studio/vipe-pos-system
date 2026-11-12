import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrintModule } from '../print/print.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

/** Delivery (T11): customers, couriers, create_delivery_order + stock + kitchen command, set_delivery_status, the audited cancel (F3b), the active board. */
@Module({
  imports: [InventoryModule, PrintModule, AuditModule, PromotionsModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
