import { Module } from '@nestjs/common';
import { RegistersController } from './registers.controller';
import { RegistersService } from './registers.service';

@Module({
  controllers: [RegistersController],
  providers: [RegistersService],
  exports: [RegistersService],
})
export class RegistersModule {}
