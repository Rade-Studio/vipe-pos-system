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
import { ManualDiscountsService } from './manual-discounts.service';
import {
  AddOrderDiscountRequest,
  addOrderDiscountSchema,
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
  parseDiscountBody,
  PriceChangedResponse,
  PricingPreview,
  PricingPreviewRequest,
  pricingPreviewSchema,
  PreviewDishLine,
  ComboLineRequest,
  RemoveOrderDiscountRequest,
  removeOrderDiscountSchema,
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
  constructor(
    private readonly orders: OrdersService,
    private readonly manualDiscounts: ManualDiscountsService,
  ) {}

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
  @ApiCreatedResponse({
    type: Order,
    description: 'Order and items in kitchen at list price, each with the automatic promotion fixed now, the discounts and the bill, stock consumed, table in kitchen.',
  })
  @ApiConflictResponse({
    description:
      'Insufficient stock (StockShortageResponse; send again with force: true), Price changed (PriceChangedResponse: a unitPrice different from the list price) or Table has an open order (TableHasOpenOrderResponse).',
    schema: { oneOf: [StockShortageResponse, PriceChangedResponse, TableHasOpenOrderResponse].map((type) => ({ $ref: `#/components/schemas/${type.name}` })) },
  })
  @ApiExtraModels(StockShortageResponse, PriceChangedResponse, TableHasOpenOrderResponse)
  @ApiForbiddenResponse({ description: 'Not admin, waiter or cashier.' })
  create(@Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Order> {
    return this.orders.create(parseInput(createOrderSchema, body), req.profile!.id);
  }

  @Post('pricing-preview')
  @Roles(...ORDER_TAKERS, 'delivery_operator')
  @HttpCode(200)
  @ApiBody({ type: PricingPreviewRequest })
  @ApiExtraModels(PreviewDishLine, ComboLineRequest)
  @ApiOkResponse({
    type: PricingPreview,
    description:
      'As if sent now (server clock, restaurant timezone, channel; with orderId the order\'s channel): the order lines (with the promotions fixed when sent, minus `voids`) and the draft lines, their discounts, the bill discount, totals (tax, tip and total with orderId) and hints ("Falta 1 unidad para otro 2x1.", "Envía antes de las 19:00.", "Domicilio: faltan $X para el 10% de descuento."). Writes nothing.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Invalid input or unknown fields (more than 20 combo lines: "lines: Máximo 20 combos por consulta"), a draft combo with the engine code, or an invalid void with body `code` void_order_required | void_item_unknown | void_quantity_invalid.',
  })
  @ApiNotFoundResponse({ description: 'orderId not found.' })
  @ApiForbiddenResponse({ description: 'Not admin, waiter, cashier or delivery operator.' })
  pricingPreview(@Body() body: unknown): Promise<PricingPreview> {
    return this.orders.pricingPreview(parseInput(pricingPreviewSchema, body));
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
  @ApiOkResponse({
    type: Order,
    description:
      'The order with the voided units removed, the automatic discounts and the bill recomputed; voiding a line of a combo voids the whole combo. Stock already consumed stays consumed.',
  })
  @ApiForbiddenResponse({ description: `Not admin, waiter or cashier, or ${VOID_REFUSALS}` })
  @ApiConflictResponse({ description: '`order_closed` (paid or cancelled).' })
  @ApiNotFoundResponse({ description: '`order_not_found`.' })
  voidItems(@Param('id') id: string, @Body() body: unknown): Promise<Order> {
    return this.orders.voidItems(parseInput(idParamSchema, id), parseInput(voidOrderItemsSchema, body));
  }

  @Post(':id/discounts')
  @Roles('admin', 'cashier')
  @ApiBody({ type: AddOrderDiscountRequest })
  @ApiCreatedResponse({
    type: Order,
    description:
      'S7: a manual discount (kind manual_item or manual_bill, source manual, reason, authorizedBy) computed by the server: on a line from its value minus the discounts already on it, on the order from the net subtotal, never above either; then the automatic discounts and the bill are recomputed. A promotion with mode manual needs no authorization (authorizedBy is the caller).',
  })
  @ApiForbiddenResponse({ description: `Not admin or cashier, or ${VOID_REFUSALS}` })
  @ApiConflictResponse({ description: '`order_closed` (paid or cancelled).' })
  @ApiNotFoundResponse({ description: '`order_not_found`.' })
  @ApiUnprocessableEntityResponse({
    description:
      '`discount_invalid`, `discount_reason_invalid`, `order_item_not_found`, `promotion_not_found`, `promotion_not_manual`, `promotion_kind_unsupported`, `promotion_not_available`, `promotion_not_applicable`, `promotion_max_uses`, `promotion_min_subtotal`, `discount_item_required`, `discount_item_not_allowed` or `discount_nothing_left`; nothing is stored.',
  })
  addDiscount(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Order> {
    return this.manualDiscounts.add(parseInput(idParamSchema, id), parseDiscountBody(addOrderDiscountSchema, body), req.profile!.id);
  }

  @Delete(':id/discounts/:discountId')
  @Roles('admin', 'cashier')
  @ApiBody({ type: RemoveOrderDiscountRequest, required: false })
  @ApiOkResponse({ type: Order, description: 'The manual discount removed (same authorization rule as adding it), the automatic discounts and the bill recomputed.' })
  @ApiForbiddenResponse({ description: `Not admin or cashier, or ${VOID_REFUSALS}` })
  @ApiConflictResponse({ description: '`order_closed` (paid or cancelled).' })
  @ApiNotFoundResponse({ description: '`order_not_found` or `discount_not_found`.' })
  @ApiUnprocessableEntityResponse({ description: '`discount_not_manual` (automatic discounts follow the promotions) or `discount_invalid`.' })
  removeDiscount(@Param('id') id: string, @Param('discountId') discountId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Order> {
    const { authorizationId } = parseDiscountBody(removeOrderDiscountSchema, body);
    return this.manualDiscounts.remove(parseInput(idParamSchema, id), parseInput(idParamSchema, discountId), authorizationId, req.profile!.id);
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
