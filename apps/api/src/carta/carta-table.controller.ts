import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import {
  CARTA_TABLE_MESSAGES as M,
  FeedbackRequest,
  feedbackSchema,
  GuestTableBill,
  GuestTableStatus,
  parseCartaInput,
  ProposalCreated,
  ProposalRequest,
  proposalSchema,
  statusQuerySchema,
  TableRequestCreated,
  TableRequestRequest,
  tableRequestSchema,
} from './carta-table.dto';
import { CartaTableService } from './carta-table.service';
import { CARTA_MESSAGES } from './carta.dto';
import {
  CARTA_FEEDBACK_LIMIT,
  CARTA_PROPOSAL_LIMIT,
  CARTA_READ_LIMIT,
  CARTA_REQUEST_LIMIT,
  RATE_LIMIT_MESSAGE,
  RateLimit,
  RateLimitGuard,
} from './rate-limit';

const NOT_FOUND = `${CARTA_MESSAGES.notFound} Unknown slug or token, unpublished carta, or another restaurant's token: one body for all.`;

/** Guest orders, bill and requests from the table QR (S12–S14): no login, rate-limited per IP and route. */
@ApiTags('carta')
@Public()
@UseGuards(RateLimitGuard)
@RateLimit(CARTA_READ_LIMIT)
@ApiNotFoundResponse({ description: NOT_FOUND })
@ApiTooManyRequestsResponse({ description: `${RATE_LIMIT_MESSAGE} Reads 120 a minute; Retry-After in seconds.` })
@Controller('carta')
export class CartaTableController {
  constructor(private readonly tables: CartaTableService) {}

  @Get(':slug/m/:token/status')
  @ApiQuery({ name: 'guestKey', required: true, type: String, description: '16-64 of [A-Za-z0-9_-].' })
  @ApiOkResponse({ type: GuestTableStatus })
  @ApiUnprocessableEntityResponse({ description: M.guestKeyInvalid })
  status(@Param('slug') slug: string, @Param('token') token: string, @Query() query: unknown): Promise<GuestTableStatus> {
    return this.tables.status(slug, token, parseCartaInput(statusQuerySchema, query).guestKey);
  }

  @Post(':slug/m/:token/proposals')
  @RateLimit(CARTA_PROPOSAL_LIMIT)
  @ApiBody({ type: ProposalRequest })
  @ApiCreatedResponse({ type: ProposalCreated, description: 'Pending until the waiter confirms it; nothing is cooked or charged before.' })
  @ApiConflictResponse({ description: `${M.orderingDisabled} | ${M.tableNotOpen} | ${M.dishUnavailable}` })
  @ApiUnprocessableEntityResponse({ description: `${M.guestKeyInvalid} | ${M.itemsInvalid} | ${M.optionsInvalid} | ${M.noteInvalid}` })
  @ApiTooManyRequestsResponse({ description: `${M.tooManyPending} (3 pending), or ${RATE_LIMIT_MESSAGE} (10 a minute).` })
  propose(@Param('slug') slug: string, @Param('token') token: string, @Body() body: unknown): Promise<ProposalCreated> {
    return this.tables.propose(slug, token, parseCartaInput(proposalSchema, body));
  }

  @Get(':slug/m/:token/bill')
  @ApiOkResponse({ type: GuestTableBill, description: 'The open order, read only; 404 when the table is closed or the bill is hidden.' })
  bill(@Param('slug') slug: string, @Param('token') token: string): Promise<GuestTableBill> {
    return this.tables.bill(slug, token);
  }

  @Post(':slug/m/:token/requests')
  @RateLimit(CARTA_REQUEST_LIMIT)
  @ApiBody({ type: TableRequestRequest })
  @ApiCreatedResponse({ type: TableRequestCreated, description: 'Ask for the bill or call the waiter; idempotent while unresolved.' })
  @ApiConflictResponse({ description: `${M.orderingDisabled} | ${M.tableNotOpen}` })
  @ApiUnprocessableEntityResponse({ description: M.kindInvalid })
  @ApiTooManyRequestsResponse({ description: `${RATE_LIMIT_MESSAGE} 6 a minute.` })
  request(@Param('slug') slug: string, @Param('token') token: string, @Body() body: unknown): Promise<TableRequestCreated> {
    return this.tables.request(slug, token, parseCartaInput(tableRequestSchema, body).kind);
  }

  @Post(':slug/feedback')
  @HttpCode(204)
  @RateLimit(CARTA_FEEDBACK_LIMIT)
  @ApiBody({ type: FeedbackRequest })
  @ApiNoContentResponse({ description: 'Stored for the restaurant.' })
  @ApiUnprocessableEntityResponse({ description: `${M.ratingInvalid} | ${M.commentInvalid}` })
  @ApiTooManyRequestsResponse({ description: `${RATE_LIMIT_MESSAGE} 3 a minute per IP; 5 per table and 50 per restaurant an hour.` })
  async feedback(@Param('slug') slug: string, @Body() body: unknown): Promise<void> {
    await this.tables.feedback(slug, parseCartaInput(feedbackSchema, body));
  }
}
