import { Module } from '@nestjs/common';
import { Clock } from '../common/clock';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** Admin overview aggregates (T12). */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, Clock],
})
export class DashboardModule {}
