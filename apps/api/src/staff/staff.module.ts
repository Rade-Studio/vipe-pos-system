import { Module } from '@nestjs/common';
import { PasswordsService } from '../auth/passwords.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/** Staff accounts (T12) over the gated helpers of migration 0011. */
@Module({
  controllers: [StaffController],
  providers: [StaffService, PasswordsService],
})
export class StaffModule {}
