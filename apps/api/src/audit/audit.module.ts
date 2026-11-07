import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { VoidsService } from './voids.service';

@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService, VoidsService],
  exports: [VoidsService],
})
export class AuditModule {}
