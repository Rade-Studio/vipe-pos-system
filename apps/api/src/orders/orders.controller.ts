import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  AddOrderItemsRequest,
  addOrderItemsSchema,
  CancelledOrder,
  CancelOrderRequest,
  cancelOrderSchema,
  CompletedOrder,
  completedOrdersQuerySchema,
  CreateOrderRequest,
  createOrderSchema,
  Order,
  ORDER_INCLUDES,
  ORDER_LIST_LIMIT,
  ORDER_STATUSES,
  orderListQuerySchema,
  PriceChangedResponse,
  ServeOrderItemsRequest,
  serveOrderItemsSchema,
  StockShortageResponse,
  TableHasOpenOrderResponse,
  UpdateOrderDetailsRequest,
  updateOrderDetailsSchema,
  UpdateOrderStatusRequest,
  updateOrderStatusSchema,
  VoidOrderItemsRequest,
  voidOrderItemsSchema,
} from './orders.dto';
import { type OrderListFilter, OrdersService } from './orders.service';

/** Roles that take orders; consume_order_stock accepts exactly these (and delivery_operator, T11). */
const ORDER_TAKERS = ['admin', 'waiter', 'cashier'];
const VOID_REFUSALS =
  '403 `authorization_required` (a supervisor PIN is needed), `authorization_invalid` (unknown, expired, used, another action) or `self_authorization_not_allowed`; the body carries `code`.';

const includeFilter = (include: readonly string[] = []): OrderListFilter => ({
  withTable: include.includes('table'),
  withWaiter: include.includes('waiter'),
});

@ApiTags('orders')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields, unknown dish, table, waiter or item.' })
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, description: `Comma-separated: ${ORDER_STATUSES.join(', ')}.` })
  @ApiQuery({
    name: 'include',
    required: false,
    description: `Comma-separated: ${ORDER_INCLUDES.join(', ')}. Items are always embedded; table adds tableNumber, waiter adds waiterName.`,
  })
  @ApiQuery({ name: 'stationId', required: false, description: 'Kitchen filter (F6): orders with a live line of this station, each with only those lines.' })
  @ApiOkResponse({ type: [Order], description: `Newest first, at most ${ORDER_LIST_LIMIT} orders.` })
  list(@Query() query: unknown): Promise<Order[]> {
    const { status, include, stationId } = parseInput(orderListQuerySchema, query);
    return this.orders.list({ statuses: status, stationId, ...includeFilter(include) });
  }

  /** Declared before :id so `completed` is not read as an order id. */
  @Get('completed')
  @ApiQuery({ name: 'date', required: true, description: "YYYY-MM-DD: paid orders created that day in the restaurant's timezone." })
  @ApiOkResponse({ type: [CompletedOrder], description: 'Newest first, with the payment and tenders or the legacy payment_transactions rows.' })
  completed(@Query() query: unknown): Promise<CompletedOrder[]> {
    return this.orders.completed(parseInput(completedOrdersQuerySchema, query).date);
  }

  /** Declared before :id so `cancelled` is not read as an order id. */
  @Get('cancelled')
  @Roles('admin')
  @ApiQuery({ name: 'date', required: true, description: "YYYY-MM-DD: orders cancelled that day in the restaurant's timezone." })
  @ApiOkResponse({
    type: [CancelledOrder],
    description:
      'Newest cancellation first, with the bill at that moment, reason, actor and supervisor; deliveries carry `delivery`, and those cancelled before the audit (0019) come as `legacy` with no reason or actor.',
  })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  cancelled(@Query() query: unknown): Promise<CancelledOrder[]> {
    return this.orders.cancelledOn(parseInput(completedOrdersQuerySchema, query).date);
  }

  @Get(':id')
  @ApiQuery({ name: 'include', required: false, description: 'Same as the list.' })
  @ApiOkResponse({ type: Order })
  @ApiNotFoundResponse()
  get(@Param('id') id: string, @Query() query: unknown): Promise<Order> {
    const { include } = parseInput(orderListQuerySchema.pick({ include: true }), query);
    return this.orders.get(parseInput(idParamSchema, id), includeFilter(include));
  }

  @Post()
  @Roles(...ORDER_TAKERS)
  @ApiBody({ type: CreateOrderRequest })
  @ApiCreatedResponse({ type: Order, description: 'Order and items in kitchen, bill computed by the database, stock consumed, table in kitchen.' })
  @ApiConflictResponse({
    description:
      'Insufficient stock (StockShortageResponse; send again with force: true), Price changed (PriceChangedResponse) or Table has an open order (TableHasOpenOrderResponse).',
    schema: { oneOf: [StockShortageResponse, PriceChangedResponse, TableHasOpenOrderResponse].map((type) => ({ $ref: `#/components/schemas/${type.name}` })) },
  })
  @ApiExtraModels(StockShortageResponse, PriceChangedResponse, TableHasOpenOrderResponse)
  @ApiForbiddenResponse({ description: 'Not admin, waiter or cashier.' })
  create(@Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Order> {
    return this.orders.create(parseInput(createOrderSchema, body), req.profile!.id);
  }

  @Post(':id/items')
  @Roles(...ORDER_TAKERS)
  @ApiBody({ type: AddOrderItemsRequest })
  @ApiCreatedResponse({ type: Order, description: 'The order back in kitchen with the new items and the recomputed bill.' })
  @ApiConflictResponse({ description: 'Insufficient stock (shortages), Price changed (prices), or Order is closed.' })
  @ApiNotFoundResponse()
  addItems(@Param('id') id: string, @Body() body: unknown): Promise<Order> {
    return this.orders.addItems(parseInput(idParamSchema, id), parseInput(addOrderItemsSchema, body));
  }

  @Patch(':id')
  @Roles(...ORDER_TAKERS)
  @ApiBody({ type: UpdateOrderDetailsRequest })
  @ApiOkResponse({ type: Order, description: 'Guests and/or the order note set (null or a blank note clears). orderNumber is refused (422).' })
  @ApiConflictResponse({ description: 'Order is closed (paid or cancelled).' })
  @ApiForbiddenResponse({ description: 'Not admin, waiter or cashier.' })
  @ApiNotFoundResponse()
  updateDetails(@Param('id') id: string, @Body() body: unknown): Promise<Order> {
    return this.orders.updateDetails(parseInput(idParamSchema, id), parseInput(updateOrderDetailsSchema, body));
  }

  @Patch(':id/status')
  @Roles('admin', 'waiter', 'kitchen')
  @ApiBody({ type: UpdateOrderStatusRequest })
  @ApiOkResponse({ type: Order, description: 'kitchen -> delivered; the table becomes served.' })
  @ApiConflictResponse({ description: 'Order is not in kitchen.' })
  @ApiNotFoundResponse()
  updateStatus(@Param('id') id: string, @Body() body: unknown): Promise<Order> {
    parseInput(updateOrderStatusSchema, body);
    return this.orders.markDelivered(parseInput(idParamSchema, id));
  }

  @Post(':id/items/served')
  @Roles('admin', 'kitchen')
  @HttpCode(200)
  @ApiBody({ type: ServeOrderItemsRequest })
  @ApiOkResponse({ type: Order, description: 'When no kitchen item remains the order is delivered and its table served.' })
  @ApiConflictResponse({ description: 'Order is closed.' })
  @ApiNotFoundResponse()
  serve(@Param('id') id: string, @Body() body: unknown): Promise<Order> {
    return this.orders.serveItems(parseInput(idParamSchema, id), parseInput(serveOrderItemsSchema, body).itemIds);
  }

  @Post(':id/cancel')
  @Roles(...ORDER_TAKERS)
  @HttpCode(200)
  @ApiBody({ type: CancelOrderRequest })
  @ApiOkResponse({ type: CancelledOrder, description: 'Cancelled, never deleted: reason, actor, supervisor and the bill are stored; the table is freed when no other open order remains.' })
  @ApiForbiddenResponse({ description: `Not admin, waiter or cashier, or ${VOID_REFUSALS}` })
  @ApiConflictResponse({
    description:
      '`order_cancelled`, `order_paid` (a table order: void the payment first), `delivery_order` (a cashier or waiter on a delivery), `delivery_not_cancellable` or `register_closed` (a paid delivery of a closed drawer).',
  })
  @ApiNotFoundResponse({ description: '`order_not_found`.' })
  cancel(@Param('id') id: string, @Body() body: unknown): Promise<CancelledOrder> {
    return this.orders.cancel(parseInput(idParamSchema, id), parseInput(cancelOrderSchema, body));
  }

  @Post(':id/items/void')
  @Roles(...ORDER_TAKERS)
  @HttpCode(200)
  @ApiBody({ type: VoidOrderItemsRequest })
  @ApiOkResponse({ type: Order, description: 'The order with the voided units removed and the bill recomputed; stock already consumed stays consumed.' })
  @ApiForbiddenResponse({ description: `Not admin, waiter or cashier, or ${VOID_REFUSALS}` })
  @ApiConflictResponse({ description: '`order_closed` (paid or cancelled).' })
  @ApiNotFoundResponse({ description: '`order_not_found`.' })
  voidItems(@Param('id') id: string, @Body() body: unknown): Promise<Order> {
    return this.orders.voidItems(parseInput(idParamSchema, id), parseInput(voidOrderItemsSchema, body));
  }

  @Delete(':id')
  @Roles(...ORDER_TAKERS)
  @HttpCode(204)
  @ApiBody({ type: CancelOrderRequest, required: false })
  @ApiNoContentResponse({
    description:
      'The audited cancellation of POST /orders/:id/cancel (orders are never deleted). Without a body only an order with nothing on it is cancelled (reason other, "Cancelada sin motivo indicado").',
  })
  @ApiForbiddenResponse({ description: `Not admin, waiter or cashier, or ${VOID_REFUSALS}` })
  @ApiConflictResponse({ description: '`order_cancelled`, `order_paid` or `delivery_order`.' })
  @ApiNotFoundResponse({ description: '`order_not_found`.' })
  async remove(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    const hasBody = body !== undefined && body !== null && !(typeof body === 'object' && Object.keys(body).length === 0);
    await this.orders.remove(parseInput(idParamSchema, id), hasBody ? parseInput(cancelOrderSchema, body) : undefined);
  }
}
