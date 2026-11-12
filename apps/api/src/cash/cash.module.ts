import { Module } from '@nestjs/common';
import { RegistersModule } from '../registers/registers.module';
import { SettingsModule } from '../settings/settings.module';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

@Module({
  imports: [RegistersModule, SettingsModule],
  controllers: [CashController],
  providers: [CashService],
})
export class CashModule {}
