import { Module } from '@nestjs/common';
import { TablesController, WaitersController } from './tables.controller';
import { TablesService } from './tables.service';

@Module({
  controllers: [TablesController, WaitersController],
  providers: [TablesService],
})
export class TablesModule {}
