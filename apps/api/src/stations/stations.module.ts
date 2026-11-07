import { Module } from '@nestjs/common';
import { StationsController } from './stations.controller';
import { StationsService } from './stations.service';

/** Stations and routes (F6): CRUD, category and dish routes; the print queue splits comandas with the same rule. */
@Module({
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService],
})
export class StationsModule {}
