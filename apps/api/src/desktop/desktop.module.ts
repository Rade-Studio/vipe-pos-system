import { Module } from '@nestjs/common';
import { DesktopAdminService } from './desktop-admin.service';
import { DesktopDeviceGuard } from './desktop-device.guard';
import { DesktopDeviceService } from './desktop-device.service';
import { DesktopPairingService } from './desktop-pairing.service';
import { DesktopAdminController, DesktopDeviceController, DesktopPairingController } from './desktop.controller';

/** VIPE desktop app (F5a): pairing, device token routes and the admin device list. Legacy /print/* stays in PrintModule. */
@Module({
  controllers: [DesktopPairingController, DesktopDeviceController, DesktopAdminController],
  providers: [DesktopPairingService, DesktopDeviceService, DesktopAdminService, DesktopDeviceGuard],
})
export class DesktopModule {}
