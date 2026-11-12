import { Body, Controller, Get, HttpCode, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { JsonNullInterceptor } from '../common/json-null.interceptor';
import { idParamSchema, parseInput } from '../common/validation';
import {
  CashRegister,
  CashTransaction,
  CloseRegisterRequest,
  CloseRegisterResult,
  closeRegisterSchema,
  CreateCashTransactionRequest,
  createCashTransactionSchema,
  OpenRegisterRequest,
  openRegisterSchema,
  PAID_ORDERS_DEFAULT,
  PAID_ORDERS_MAX,
  paidOrdersQuerySchema,
  REGISTER_INCLUDES,
  registerIncludeQuerySchema,
  registerListQuerySchema,
  RegisterSummary,
  registerSummaryQuerySchema,
  RegisterPaidOrder,
} from './registers.dto';
import { type RegisterIncludes, RegistersService } from './registers.service';

/** Roles that run the drawer; close_register re-checks them (42501). */
const DRAWER_ROLES = ['admin', 'cashier'];
const INCLUDE_DESCRIPTION = `Comma-separated: ${REGISTER_INCLUDES.join(', ')} (legacy payment_transactions and cash movements).`;

const includes = (include: readonly string[] = []): RegisterIncludes => ({
  transactions: include.includes('transactions'),
  cashTransactions: include.includes('cashTransactions'),
});

@ApiTags('registers')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields; RPC errors keep their SQLSTATE in `code`.' })
@Controller('registers')
export class RegistersController {
  constructor(private readonly registers: RegistersService) {}

  @Get()
  @ApiQuery({ name: 'date', required: false, description: "YYYY-MM-DD: registers opened that day in the restaurant's timezone." })
  @ApiQuery({ name: 'include', required: false, description: INCLUDE_DESCRIPTION })
  @ApiOkResponse({ type: [CashRegister], description: 'Newest opening first.' })
  list(@Query() query: unknown): Promise<CashRegister[]> {
    const { date, include } = parseInput(registerListQuerySchema, query);
    return this.registers.list({ date, ...includes(include) });
  }

  @Get('current')
  @UseInterceptors(JsonNullInterceptor)
  @ApiQuery({ name: 'include', required: false, description: INCLUDE_DESCRIPTION })
  @ApiOkResponse({ type: CashRegister, description: 'The open register, or null (200) when none is open.' })
  current(@Query() query: unknown): Promise<CashRegister | null> {
    const { include } = parseInput(registerIncludeQuerySchema, query);
    return this.registers.current(includes(include));
  }

  @Get('summary')
  @ApiQuery({ name: 'ids', required: true, description: 'Comma-separated register ids (1..100).' })
  @ApiOkResponse({ type: RegisterSummary, description: 'register_summary over the registers.' })
  @ApiForbiddenResponse({ description: 'Not admin, cashier or delivery_operator (42501 from the RPC).' })
  @ApiNotFoundResponse({ description: 'An id is unknown or of another restaurant (P0002).' })
  summary(@Query() query: unknown): Promise<RegisterSummary> {
    return this.registers.summary(parseInput(registerSummaryQuerySchema, query).ids);
  }

  @Post('open')
  @Roles(...DRAWER_ROLES)
  @ApiBody({ type: OpenRegisterRequest })
  @ApiCreatedResponse({ type: CashRegister, description: 'openingTimestamp is the server clock.' })
  @ApiConflictResponse({ description: 'A register is already open.' })
  @ApiForbiddenResponse({ description: 'Not admin or cashier.' })
  open(@Body() body: unknown): Promise<CashRegister> {
    return this.registers.open(parseInput(openRegisterSchema, body).initialCash);
  }

  @Get(':id')
  @ApiQuery({ name: 'include', required: false, description: INCLUDE_DESCRIPTION })
  @ApiOkResponse({ type: CashRegister })
  @ApiNotFoundResponse()
  get(@Param('id') id: string, @Query() query: unknown): Promise<CashRegister> {
    const { include } = parseInput(registerIncludeQuerySchema, query);
    return this.registers.get(parseInput(idParamSchema, id), includes(include));
  }

  @Post(':id/close')
  @Roles(...DRAWER_ROLES)
  @HttpCode(200)
  @ApiBody({ type: CloseRegisterRequest, required: false })
  @ApiOkResponse({
    type: CloseRegisterResult,
    description: 'close_register result with the stored count; a replay answers already_closed and keeps the count of the first close.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Invalid body, or code counted_cash_required (open register without countedCash), count_mismatch (denominations do not add up to countedCash) or note_required (countedCash differs from the expected cash after tips and no note).',
  })
  @ApiConflictResponse({
    description: 'code open_orders (with count): the restaurant has open orders (active, kitchen, delivered) and the body lacks leaveOpenOrders: true; the register stays open.',
  })
  @ApiNotFoundResponse({ description: 'Unknown or of another restaurant (P0002).' })
  @ApiForbiddenResponse({ description: 'Not admin or cashier.' })
  close(@Param('id') id: string, @Body() body: unknown): Promise<CloseRegisterResult> {
    return this.registers.close(parseInput(idParamSchema, id), parseInput(closeRegisterSchema, body));
  }

  @Get(':id/paid-orders')
  @Roles(...DRAWER_ROLES)
  @ApiQuery({ name: 'limit', required: false, description: `1..${PAID_ORDERS_MAX}, default ${PAID_ORDERS_DEFAULT}.` })
  @ApiOkResponse({
    type: [RegisterPaidOrder],
    description: 'Paid orders of the register (one per pay_order payment), newest payment first; legacy payment_transactions are not listed.',
  })
  @ApiNotFoundResponse({ description: 'Unknown or of another restaurant.' })
  @ApiForbiddenResponse({ description: 'Not admin or cashier.' })
  paidOrders(@Param('id') id: string, @Query() query: unknown): Promise<RegisterPaidOrder[]> {
    return this.registers.paidOrders(parseInput(idParamSchema, id), parseInput(paidOrdersQuerySchema, query).limit);
  }
  @Get(':id/cash-transactions')
  @ApiOkResponse({ type: [CashTransaction], description: 'Newest first.' })
  @ApiNotFoundResponse()
  cashTransactions(@Param('id') id: string): Promise<CashTransaction[]> {
    return this.registers.listCashTransactions(parseInput(idParamSchema, id));
  }

  @Post(':id/cash-transactions')
  @Roles(...DRAWER_ROLES)
  @ApiBody({ type: CreateCashTransactionRequest })
  @ApiCreatedResponse({ type: CashTransaction, description: 'timestamp is the server clock.' })
  @ApiConflictResponse({ description: 'Register is closed.' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid body (reason missing or unknown), or code description_required (reason other without a description).' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin or cashier.' })
  addCashTransaction(@Param('id') id: string, @Body() body: unknown): Promise<CashTransaction> {
    return this.registers.addCashTransaction(parseInput(idParamSchema, id), parseInput(createCashTransactionSchema, body));
  }
}
