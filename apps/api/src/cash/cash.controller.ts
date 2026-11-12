import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiParam, ApiQuery, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import { CashDay, CashLedger, CashReport, dayParamSchema, MAX_REPORT_DAYS, REPORT_GROUPS, reportQuerySchema } from './cash.dto';
import { CashService } from './cash.service';

const DATE_DESCRIPTION = 'Business day YYYY-MM-DD: registers opened that day in the restaurant timezone, moved back by businessDayCutoffHour.';

@ApiTags('cash')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an admin.' })
@Controller('cash')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('days/:date')
  @ApiParam({ name: 'date', description: DATE_DESCRIPTION })
  @ApiOkResponse({ type: CashDay, description: 'Day summary (tablero): registers, totals, tips by waiter, voids and the same weekday last week.' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid date.' })
  day(@Param('date') date: string): Promise<CashDay> {
    return this.cash.day(parseInput(dayParamSchema, date));
  }

  @Get('days/:date/ledger')
  @ApiParam({ name: 'date', description: DATE_DESCRIPTION })
  @ApiOkResponse({ type: CashLedger, description: 'Day ledger (libro) with a running cash balance per register.' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid date.' })
  ledger(@Param('date') date: string): Promise<CashLedger> {
    return this.cash.ledger(parseInput(dayParamSchema, date));
  }

  @Get('report')
  @ApiQuery({ name: 'from', required: true, description: 'First business day, YYYY-MM-DD.' })
  @ApiQuery({ name: 'to', required: true, description: 'Last business day, YYYY-MM-DD (included).' })
  @ApiQuery({ name: 'group', required: true, enum: REPORT_GROUPS })
  @ApiOkResponse({ type: CashReport, description: 'Period summary grouped by day, ISO week or month, with the previous period.' })
  @ApiUnprocessableEntityResponse({
    description: `Invalid query, or code range_inverted (from after to) or range_too_long (more than ${MAX_REPORT_DAYS} days).`,
  })
  report(@Query() query: unknown): Promise<CashReport> {
    const { from, to, group } = parseInput(reportQuerySchema, query);
    return this.cash.report(from, to, group);
  }
}
