import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SettingsModule } from '../settings/settings.module';
import { PrintController, PrinterDevicesController } from './print.controller';
import { PrintService } from './print.service';
import { PrinterTokenGuard } from './printer-token.guard';

/** Printing bridge (T8c): print queue, printer tokens, `print_job` to `printers:<restaurantId>`. */
@Module({
  imports: [RealtimeModule, SettingsModule],
  controllers: [PrintController, PrinterDevicesController],
  providers: [PrintService, PrinterTokenGuard],
  exports: [PrintService],
})
export class PrintModule {}
