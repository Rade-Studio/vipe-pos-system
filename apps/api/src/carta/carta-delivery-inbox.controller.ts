import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import { CARTA_DELIVERY_MESSAGES as M, DeliveryInboxRequest, DeliveryRequestConfirmed, parseDeliveryInput } from './carta-delivery.dto';
import { CartaDeliveryInboxService } from './carta-delivery-inbox.service';
import { CARTA_TABLE_MESSAGES as T, RejectProposalRequest, rejectSchema } from './carta-table.dto';

/** The roles that read the customer registry (private.carta_delivery_staff_restaurant). */
const DELIVERY_STAFF = ['admin', 'cashier', 'delivery_operator'];
/** create_delivery_order takes admin and delivery_operator only, so a cashier cannot confirm. */
const DELIVERY_TAKERS = ['admin', 'delivery_operator'];

@ApiTags('carta-delivery')
@ApiCookieAuth()
@Roles(...DELIVERY_STAFF)
@ApiForbiddenResponse({ description: 'Not an admin, cashier or delivery operator (confirm: admin or delivery operator).' })
@Controller('carta-delivery')
export class CartaDeliveryInboxController {
  constructor(private readonly inbox: CartaDeliveryInboxService) {}

  @Get()
  @ApiOkResponse({ type: [DeliveryInboxRequest], description: 'Pending guest delivery requests, newest first.' })
  list(): Promise<DeliveryInboxRequest[]> {
    return this.inbox.list();
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Roles(...DELIVERY_TAKERS)
  @ApiOkResponse({ type: DeliveryRequestConfirmed, description: 'The delivery order was created as POST /delivery/orders does (stock, kitchen ticket) and linked.' })
  @ApiNotFoundResponse({ description: M.requestNotFound })
  @ApiConflictResponse({ description: T.proposalNotPending })
  @ApiUnprocessableEntityResponse({ description: 'Invalid id, or the console path refused a line (options, dish).' })
  confirm(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<DeliveryRequestConfirmed> {
    return this.inbox.confirm(parseInput(idParamSchema, id), req.profile!);
  }

  @Post(':id/reject')
  @HttpCode(204)
  @ApiBody({ type: RejectProposalRequest })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: M.requestNotFound })
  @ApiConflictResponse({ description: T.proposalNotPending })
  @ApiUnprocessableEntityResponse({ description: T.reasonInvalid })
  async reject(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    await this.inbox.reject(parseInput(idParamSchema, id), parseDeliveryInput(rejectSchema, body).reason ?? null);
  }
}
