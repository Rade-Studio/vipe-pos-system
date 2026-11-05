import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
  Courier,
  courierListQuerySchema,
  CreateCourierRequest,
  createCourierSchema,
  CreateDeliveryOrderRequest,
  CreateDeliveryOrderResult,
  createDeliveryOrderSchema,
  customerQuerySchema,
  CustomerWithAddresses,
  DeliveryOrder,
  DeliveryOrderWithBill,
  SetDeliveryStatusRequest,
  setDeliveryStatusSchema,
  UpdateCourierRequest,
  updateCourierSchema,
} from './delivery.dto';
import { DeliveryService } from './delivery.service';

/** Roles the customers and couriers RLS policies let read. */
const REGISTRY_READERS = ['admin', 'cashier', 'delivery_operator'];

/**
 * POST /delivery/orders and /status carry no @Roles: create_delivery_order
 * (admin, delivery_operator) and set_delivery_status (kitchen may
 * start_preparing and mark_ready) own the role matrix and answer 42501.
 */
@ApiTags('delivery')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or an RPC rejection (P0001, 22023) with its message verbatim and `code`.' })
@Controller('delivery')
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('customers')
  @Roles(...REGISTRY_READERS)
  @ApiQuery({ name: 'phone', required: true, description: 'Normalised server-side like the web (formatting and a +57 mobile prefix dropped).' })
  @ApiOkResponse({ type: CustomerWithAddresses })
  @ApiNotFoundResponse({ description: 'Customer not found.' })
  @ApiForbiddenResponse()
  findCustomer(@Query() query: unknown): Promise<CustomerWithAddresses> {
    return this.delivery.findCustomer(parseInput(customerQuerySchema, query).phone);
  }

  @Get('couriers')
  @Roles(...REGISTRY_READERS)
  @ApiQuery({ name: 'activeOnly', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({ type: [Courier], description: 'Ordered by name.' })
  @ApiForbiddenResponse()
  listCouriers(@Query() query: unknown): Promise<Courier[]> {
    return this.delivery.listCouriers(parseInput(courierListQuerySchema, query).activeOnly ?? false);
  }

  @Post('couriers')
  @Roles('admin')
  @ApiBody({ type: CreateCourierRequest })
  @ApiCreatedResponse({ type: Courier })
  @ApiForbiddenResponse()
  createCourier(@Body() body: unknown): Promise<Courier> {
    return this.delivery.createCourier(parseInput(createCourierSchema, body));
  }

  @Patch('couriers/:id')
  @Roles('admin')
  @ApiBody({ type: UpdateCourierRequest })
  @ApiOkResponse({ type: Courier })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse()
  updateCourier(@Param('id') id: string, @Body() body: unknown): Promise<Courier> {
    return this.delivery.updateCourier(parseInput(idParamSchema, id), parseInput(updateCourierSchema, body));
  }

  @Post('orders')
  @ApiBody({ type: CreateDeliveryOrderRequest })
  @ApiCreatedResponse({
    type: CreateDeliveryOrderResult,
    description: 'create_delivery_order, consume_order_stock and the kitchen command job in one transaction.',
  })
  @ApiNotFoundResponse({ description: 'P0002: customer, address or dish not found.' })
  @ApiForbiddenResponse({ description: '42501: not admin or delivery_operator.' })
  createOrder(@Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<CreateDeliveryOrderResult> {
    return this.delivery.createOrder(parseInput(createDeliveryOrderSchema, body), req.profile!);
  }

  @Post('orders/:id/status')
  @HttpCode(200)
  @ApiBody({ type: SetDeliveryStatusRequest })
  @ApiOkResponse({ type: DeliveryOrder })
  @ApiNotFoundResponse({ description: 'P0002: delivery or courier not found.' })
  @ApiForbiddenResponse({ description: '42501: the role may not perform the action.' })
  setStatus(@Param('id') id: string, @Body() body: unknown): Promise<DeliveryOrder> {
    return this.delivery.setStatus(parseInput(idParamSchema, id), parseInput(setDeliveryStatusSchema, body));
  }

  @Get('active')
  @Roles('admin', 'cashier', 'delivery_operator', 'kitchen')
  @ApiOkResponse({
    type: [DeliveryOrderWithBill],
    description: "Open deliveries plus those delivered or cancelled today (restaurant timezone), newest update first.",
  })
  @ApiForbiddenResponse()
  listActive(): Promise<DeliveryOrderWithBill[]> {
    return this.delivery.listActive();
  }
}
