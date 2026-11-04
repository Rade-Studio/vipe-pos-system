import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/** S3-compatible presigned uploads (T12); optional at boot (503 without S3_*). */
@Module({
  controllers: [StorageController],
  providers: [StorageService],
})
export class StorageModule {}
