import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController, PaymentsController, SplitController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuditModule, PromotionsModule],
  controllers: [PaymentMethodsController, PaymentsController, SplitController],
  providers: [PaymentMethodsService, PaymentsService],
})
export class PaymentsModule {}
