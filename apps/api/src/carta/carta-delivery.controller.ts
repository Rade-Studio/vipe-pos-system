import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import {
  CARTA_DELIVERY_MESSAGES as M,
  DeliverySubmitRequest,
  DeliverySubmitted,
  deliverySubmitSchema,
  GuestDeliveryStatus,
  GuestPricing,
  GuestPricingRequest,
  parseDeliveryInput,
  parseTrackingToken,
  pricingPreviewSchema,
} from './carta-delivery.dto';
import { CartaDeliveryService } from './carta-delivery.service';
import { CARTA_TABLE_MESSAGES as T } from './carta-table.dto';
import { CARTA_MESSAGES } from './carta.dto';
import { CARTA_DELIVERY_LIMIT, CARTA_PRICING_LIMIT, CARTA_READ_LIMIT, RATE_LIMIT_MESSAGE, RateLimit, RateLimitGuard } from './rate-limit';

const NOT_FOUND = `${CARTA_MESSAGES.notFound} Unknown slug or tracking token, unpublished carta, or another restaurant's token: one body for all.`;
const FIELDS = `${M.nameInvalid} | ${M.phoneInvalid} | ${M.addressInvalid} | ${M.neighborhoodInvalid} | ${M.paymentInvalid} | ${T.itemsInvalid} | ${T.optionsInvalid} | ${T.noteInvalid}`;

/** Guest delivery from the public carta (S15): no login, rate-limited per IP and route. */
@ApiTags('carta')
@Public()
@UseGuards(RateLimitGuard)
@RateLimit(CARTA_READ_LIMIT)
@ApiNotFoundResponse({ description: NOT_FOUND })
@ApiTooManyRequestsResponse({ description: `${RATE_LIMIT_MESSAGE} Reads 120 a minute; Retry-After in seconds.` })
@Controller('carta')
export class CartaDeliveryController {
  constructor(private readonly delivery: CartaDeliveryService) {}

  @Post(':slug/delivery')
  @RateLimit(CARTA_DELIVERY_LIMIT)
  @ApiBody({ type: DeliverySubmitRequest })
  @ApiCreatedResponse({ type: DeliverySubmitted, description: 'Pending in the delivery inbox; stock and the kitchen ticket happen only when an operator confirms it.' })
  @ApiConflictResponse({ description: `${M.orderingDisabled} | ${T.dishUnavailable}` })
  @ApiUnprocessableEntityResponse({ description: FIELDS })
  @ApiTooManyRequestsResponse({ description: `${M.tooManyPending} (2 pending per phone) | ${M.tooBusy} (30 pending within the hour) | ${RATE_LIMIT_MESSAGE} (3 a minute).` })
  submit(@Param('slug') slug: string, @Body() body: unknown): Promise<DeliverySubmitted> {
    return this.delivery.submit(slug, parseDeliveryInput(deliverySubmitSchema, body));
  }

  @Get(':slug/delivery/:trackingToken')
  @ApiOkResponse({ type: GuestDeliveryStatus, description: '"Pedido D-0142 recibido": the stage of the request and, once confirmed, of its delivery.' })
  status(@Param('slug') slug: string, @Param('trackingToken') trackingToken: string): Promise<GuestDeliveryStatus> {
    return this.delivery.status(slug, parseTrackingToken(trackingToken));
  }

  @Post(':slug/pricing-preview')
  @HttpCode(200)
  @RateLimit(CARTA_PRICING_LIMIT)
  @ApiBody({ type: GuestPricingRequest })
  @ApiOkResponse({ type: GuestPricing, description: 'The totals the guest will see, with the engine of POST /orders/pricing-preview; writes nothing.' })
  @ApiConflictResponse({ description: T.dishUnavailable })
  @ApiUnprocessableEntityResponse({ description: `${M.channelInvalid} | ${T.itemsInvalid} | ${T.optionsInvalid}` })
  @ApiTooManyRequestsResponse({ description: `${RATE_LIMIT_MESSAGE} 30 a minute.` })
  pricing(@Param('slug') slug: string, @Body() body: unknown): Promise<GuestPricing> {
    return this.delivery.pricing(slug, parseDeliveryInput(pricingPreviewSchema, body));
  }
}
