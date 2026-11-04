import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { PrintController, PrinterDevicesController } from './print.controller';
import { PrintService } from './print.service';
import { PrinterTokenGuard } from './printer-token.guard';

/** Printing bridge (T8c): print queue, printer tokens, `print_job` to `printers:<restaurantId>`. */
@Module({
  imports: [RealtimeModule],
  controllers: [PrintController, PrinterDevicesController],
  providers: [PrintService, PrinterTokenGuard],
})
export class PrintModule {}
