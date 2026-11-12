import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { parseInput } from '../common/validation';
import {
  CashDay,
  CashLedger,
  CashReport,
  CashZList,
  CashZReport,
  dayParamSchema,
  MAX_REPORT_DAYS,
  REPORT_GROUPS,
  reportQuerySchema,
  zListQuerySchema,
  zNumberParamSchema,
} from './cash.dto';
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

  @Post('days/:date/z')
  @HttpCode(200)
  @ApiParam({ name: 'date', description: DATE_DESCRIPTION })
  @ApiOkResponse({
    type: CashZReport,
    description: 'Emitir informe Z: numbers the closed day (consecutive per restaurant) and stores its snapshot; a second emit returns the stored Z.',
  })
  @ApiConflictResponse({ description: 'code day_open (a register of the day is open) or day_empty (no registers that day).' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid date.' })
  emitZ(@Param('date') date: string): Promise<CashZReport> {
    return this.cash.emitZ(parseInput(dayParamSchema, date));
  }

  @Get('z')
  @ApiQuery({ name: 'from', required: true, description: 'First business day, YYYY-MM-DD.' })
  @ApiQuery({ name: 'to', required: true, description: 'Last business day, YYYY-MM-DD (included).' })
  @ApiOkResponse({ type: CashZList, description: 'Informes Z of the range by number, with the gaps in the numbering.' })
  @ApiUnprocessableEntityResponse({ description: `Invalid query, or code range_inverted or range_too_long (more than ${MAX_REPORT_DAYS} days).` })
  zList(@Query() query: unknown): Promise<CashZList> {
    const { from, to } = parseInput(zListQuerySchema, query);
    return this.cash.zList(from, to);
  }

  @Get('z/:number')
  @ApiParam({ name: 'number', type: Number, description: 'Z number of the restaurant.' })
  @ApiOkResponse({ type: CashZReport, description: 'One informe Z with its full snapshot (reimprimir).' })
  @ApiNotFoundResponse({ description: 'No Z with that number in the restaurant.' })
  @ApiUnprocessableEntityResponse({ description: 'Not a Z number.' })
  z(@Param('number') number: string): Promise<CashZReport> {
    return this.cash.z(parseInput(zNumberParamSchema, number));
  }
}
