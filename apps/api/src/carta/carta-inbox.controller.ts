import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import { CartaInboxService } from './carta-inbox.service';
import { CARTA_TABLE_MESSAGES as M, CartaInbox, parseCartaInput, ProposalConfirmed, RejectProposalRequest, rejectSchema } from './carta-table.dto';

/** The roles that take table orders (private.carta_staff_restaurant); kitchen and delivery_operator do not. */
const TABLE_ORDER_TAKERS = ['admin', 'cashier', 'waiter'];

@ApiTags('carta-inbox')
@ApiCookieAuth()
@Roles(...TABLE_ORDER_TAKERS)
@ApiForbiddenResponse({ description: 'Not an admin, cashier or waiter.' })
@Controller('carta-inbox')
export class CartaInboxController {
  constructor(private readonly inbox: CartaInboxService) {}

  @Get()
  @ApiOkResponse({ type: CartaInbox, description: "Guest proposals and requests of the restaurant's open orders." })
  list(): Promise<CartaInbox> {
    return this.inbox.inbox();
  }

  @Post('proposals/:id/confirm')
  @HttpCode(200)
  @ApiOkResponse({ type: ProposalConfirmed, description: 'The items were added to the open order as the waiter sends them.' })
  @ApiNotFoundResponse({ description: M.proposalNotFound })
  @ApiConflictResponse({ description: `${M.proposalNotPending} | ${M.orderNotOpen}, or the waiter send's own 409s (stock, price).` })
  @ApiUnprocessableEntityResponse({ description: 'Invalid id, or the waiter send refused a line (dish, options).' })
  confirm(@Param('id') id: string): Promise<ProposalConfirmed> {
    return this.inbox.confirm(parseInput(idParamSchema, id));
  }

  @Post('proposals/:id/reject')
  @HttpCode(204)
  @ApiBody({ type: RejectProposalRequest })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: M.proposalNotFound })
  @ApiConflictResponse({ description: M.proposalNotPending })
  @ApiUnprocessableEntityResponse({ description: M.reasonInvalid })
  async reject(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    await this.inbox.reject(parseInput(idParamSchema, id), parseCartaInput(rejectSchema, body).reason ?? null);
  }

  @Post('requests/:id/resolve')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Resolved (an already resolved request stays as it is).' })
  @ApiNotFoundResponse({ description: M.requestNotFound })
  async resolve(@Param('id') id: string): Promise<void> {
    await this.inbox.resolve(parseInput(idParamSchema, id));
  }
}
