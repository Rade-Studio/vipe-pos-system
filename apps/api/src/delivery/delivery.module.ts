import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PrintModule } from '../print/print.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

/** Delivery (T11): customers, couriers, create_delivery_order + stock + kitchen command, set_delivery_status, the active board. */
@Module({
  imports: [InventoryModule, PrintModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
