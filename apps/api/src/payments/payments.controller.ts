import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
import { idParamSchema, parseInput } from '../common/validation';
import { PaymentMethodsService } from './payment-methods.service';
import {
  CreatePaymentMethodRequest,
  createPaymentMethodSchema,
  Payment,
  PAYMENT_FILTER_LIMIT,
  paymentListQuerySchema,
  PaymentMethod,
  PayOrderRequest,
  PayOrderResult,
  payOrderSchema,
  ReorderPaymentMethodsRequest,
  reorderPaymentMethodsSchema,
  SplitOrderRequest,
  SplitOrderResult,
  splitOrderSchema,
  UndoSplitResult,
  UpdatePaymentMethodRequest,
  updatePaymentMethodSchema,
  PaymentVoid,
  VoidPaymentRequest,
  voidPaymentSchema,
} from './payments.dto';
import { COMBO_SPLIT_MESSAGE, PaymentsService } from './payments.service';

/** The payment_methods write policies admit admin only. */
const ADMIN = 'admin';
/** pay_order admits these roles (and re-checks them). */
const SETTLERS = ['admin', 'cashier', 'delivery_operator'];
/** split_order and undo_split admit these roles (and re-check them). */
const SPLITTERS = ['admin', 'cashier'];
const RPC_ERRORS =
  'RPC errors keep their SQLSTATE in `code`: 422 P0001 (rule violation, message verbatim), 404 P0002, 403 42501, 422 22023.';

@ApiTags('payments')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('payments/methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  @ApiOkResponse({ type: [PaymentMethod], description: 'Every method, inactive included, by sortOrder.' })
  list(): Promise<PaymentMethod[]> {
    return this.methods.list();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreatePaymentMethodRequest })
  @ApiCreatedResponse({ type: PaymentMethod, description: 'code derived from the name (unique), appended last.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<PaymentMethod> {
    return this.methods.create(parseInput(createPaymentMethodSchema, body));
  }

  @Put('order')
  @Roles(ADMIN)
  @ApiBody({ type: ReorderPaymentMethodsRequest })
  @ApiOkResponse({ type: [PaymentMethod], description: 'sortOrder = position in ids, all or nothing.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  reorder(@Body() body: unknown): Promise<PaymentMethod[]> {
    return this.methods.reorder(parseInput(reorderPaymentMethodsSchema, body).ids);
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdatePaymentMethodRequest })
  @ApiOkResponse({ type: PaymentMethod })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') id: string, @Body() body: unknown): Promise<PaymentMethod> {
    return this.methods.update(parseInput(idParamSchema, id), parseInput(updatePaymentMethodSchema, body));
  }
}

@ApiTags('payments')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @ApiQuery({ name: 'orderIds', required: false, description: `Comma-separated order ids (at most ${PAYMENT_FILTER_LIMIT}).` })
  @ApiQuery({ name: 'cashRegisterIds', required: false, description: 'Comma-separated register ids. Send exactly one filter.' })
  @ApiOkResponse({ type: [Payment], description: 'Tenders embedded, newest first; [] for an empty list.' })
  list(@Query() query: unknown): Promise<Payment[]> {
    return this.payments.list(parseInput(paymentListQuerySchema, query));
  }

  @Post()
  @Roles(...SETTLERS)
  @HttpCode(200)
  @ApiBody({ type: PayOrderRequest })
  @ApiOkResponse({ type: PayOrderResult, description: 'pay_order result; a replay with the same idempotencyKey answers already_paid.' })
  @ApiNotFoundResponse({ description: 'Order not found (P0002).' })
  @ApiForbiddenResponse({ description: 'Not admin, cashier or delivery_operator.' })
  pay(@Body() body: unknown): Promise<PayOrderResult> {
    return this.payments.pay(parseInput(payOrderSchema, body));
  }

  @Post(':id/void')
  @Roles(...SPLITTERS)
  @HttpCode(200)
  @ApiBody({ type: VoidPaymentRequest })
  @ApiOkResponse({
    type: PaymentVoid,
    description: 'Voided, never deleted: the payment counts in no total and is no longer listed; the order is open again (delivered).',
  })
  @ApiForbiddenResponse({
    description: 'Not admin or cashier, or 403 `authorization_required`, `authorization_invalid` or `self_authorization_not_allowed` (body `code`).',
  })
  @ApiConflictResponse({ description: '`payment_voided` or `register_closed` (the drawer of the payment is closed).' })
  @ApiNotFoundResponse({ description: '`payment_not_found`.' })
  void(@Param('id') id: string, @Body() body: unknown): Promise<PaymentVoid> {
    return this.payments.void(parseInput(idParamSchema, id), parseInput(voidPaymentSchema, body));
  }
}

@ApiTags('payments')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('orders')
export class SplitController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/split')
  @Roles(...SPLITTERS)
  @HttpCode(200)
  @ApiBody({ type: SplitOrderRequest })
  @ApiOkResponse({ type: SplitOrderResult, description: 'split_order: the items move to a new partial child order; both bills recomputed.' })
  @ApiUnprocessableEntityResponse({
    description: `Invalid input or unknown fields. ${RPC_ERRORS} Moving only part of a combo (promociones S5) is 422 \`combo_split_not_allowed\` (body \`code\`) "${COMBO_SPLIT_MESSAGE}"; nothing moves.`,
  })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin or cashier.' })
  split(@Param('id') id: string, @Body() body: unknown): Promise<SplitOrderResult> {
    return this.payments.split(parseInput(idParamSchema, id), parseInput(splitOrderSchema, body));
  }

  @Post(':id/undo-split')
  @Roles(...SPLITTERS)
  @HttpCode(200)
  @ApiOkResponse({ type: UndoSplitResult, description: 'undo_split on the partial child order :id: its items go back to the parent.' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin or cashier.' })
  undoSplit(@Param('id') id: string): Promise<UndoSplitResult> {
    return this.payments.undoSplit(parseInput(idParamSchema, id));
  }
}
