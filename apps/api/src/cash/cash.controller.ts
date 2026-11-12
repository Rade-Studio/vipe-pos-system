import { Controller, Get, Param } from '@nestjs/common';
import { ApiCookieAuth, ApiForbiddenResponse, ApiOkResponse, ApiParam, ApiTags, ApiUnprocessableEntityResponse } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import { CashDay, CashLedger, dayParamSchema } from './cash.dto';
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
}
