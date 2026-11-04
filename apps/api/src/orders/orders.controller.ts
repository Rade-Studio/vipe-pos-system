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
  UpdateOrderStatusRequest,
  updateOrderStatusSchema,
} from './orders.dto';
import { type OrderListFilter, OrdersService } from './orders.service';

/** Roles that take orders; consume_order_stock accepts exactly these (and delivery_operator, T11). */
const ORDER_TAKERS = ['admin', 'waiter', 'cashier'];

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
  @ApiOkResponse({ type: [Order], description: `Newest first, at most ${ORDER_LIST_LIMIT} orders.` })
  list(@Query() query: unknown): Promise<Order[]> {
    const { status, include } = parseInput(orderListQuerySchema, query);
    return this.orders.list({ statuses: status, ...includeFilter(include) });
  }

  /** Declared before :id so `completed` is not read as an order id. */
  @Get('completed')
  @ApiQuery({ name: 'date', required: true, description: "YYYY-MM-DD: paid orders created that day in the restaurant's timezone." })
  @ApiOkResponse({ type: [CompletedOrder], description: 'Newest first, with the payment and tenders or the legacy payment_transactions rows.' })
  completed(@Query() query: unknown): Promise<CompletedOrder[]> {
    return this.orders.completed(parseInput(completedOrdersQuerySchema, query).date);
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

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Order and items deleted (delete_order_with_items); the table is freed when no other open order remains.' })
  @ApiConflictResponse({ description: 'Order is paid.' })
  @ApiNotFoundResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.orders.remove(parseInput(idParamSchema, id));
  }
}
