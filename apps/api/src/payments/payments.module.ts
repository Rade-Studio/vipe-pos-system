import { Module } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController, PaymentsController, SplitController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentMethodsController, PaymentsController, SplitController],
  providers: [PaymentMethodsService, PaymentsService],
})
export class PaymentsModule {}
