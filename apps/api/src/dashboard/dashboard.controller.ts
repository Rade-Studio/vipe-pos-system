import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import { DashboardSummary, DEFAULT_DAYS, summaryQuerySchema } from './dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an admin.' })
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiQuery({ name: 'days', required: false, description: `Window of dailySales and popularDishes, 1-366 (default ${DEFAULT_DAYS}).` })
  @ApiOkResponse({ type: DashboardSummary })
  @ApiUnprocessableEntityResponse({ description: 'Invalid days or unknown query fields.' })
  summary(@Query() query: unknown): Promise<DashboardSummary> {
    return this.dashboard.summary(parseInput(summaryQuerySchema, query).days);
  }
}
