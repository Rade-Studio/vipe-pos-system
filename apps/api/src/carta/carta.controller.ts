import { Controller, Get, Headers, Param, Query, UseGuards } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiParam, ApiQuery, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { ORDER_CHANNELS } from '../catalog/catalog.dto';
import { parseInput } from '../common/validation';
import { Carta, CARTA_LANGS, CARTA_MESSAGES, CartaDishShare, cartaQuerySchema, cartaTableQuerySchema } from './carta.dto';
import { CartaService } from './carta.service';
import { CARTA_READ_LIMIT, RATE_LIMIT_MESSAGE, RateLimit, RateLimitGuard } from './rate-limit';

const NOT_FOUND = `${CARTA_MESSAGES.notFound} Unknown or invalid slug, carta not published, unknown or old table token, or a dish the carta does not list: one body for all.`;

@ApiTags('carta')
@Public()
@UseGuards(RateLimitGuard)
@RateLimit(CARTA_READ_LIMIT)
@ApiNotFoundResponse({ description: NOT_FOUND })
@ApiTooManyRequestsResponse({ description: `${RATE_LIMIT_MESSAGE} 120 reads a minute per IP and route; Retry-After in seconds.` })
@Controller('carta')
export class CartaController {
  constructor(private readonly carta: CartaService) {}

  @Get(':slug')
  @ApiParam({ name: 'slug', example: 'brasa-y-lena' })
  @ApiQuery({ name: 'channel', required: false, enum: ORDER_CHANNELS, description: 'Channel of the promotion fields; default delivery.' })
  @ApiQuery({ name: 'lang', required: false, enum: CARTA_LANGS, description: 'Wins over Accept-Language.' })
  @ApiOkResponse({ type: Carta, description: 'The public menu of a published carta (no login).' })
  get(@Param('slug') slug: string, @Query() query: unknown, @Headers('accept-language') acceptLanguage?: string): Promise<Carta> {
    const { channel, lang } = parseInput(cartaQuerySchema, query);
    return this.carta.carta(slug, channel, lang, acceptLanguage);
  }

  @Get(':slug/m/:token')
  @ApiParam({ name: 'token', description: 'Table QR token (24 characters).' })
  @ApiQuery({ name: 'lang', required: false, enum: CARTA_LANGS })
  @ApiOkResponse({ type: Carta, description: 'The table of the QR and the dine_in menu.' })
  table(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Query() query: unknown,
    @Headers('accept-language') acceptLanguage?: string,
  ): Promise<Carta> {
    return this.carta.table(slug, token, parseInput(cartaTableQuerySchema, query).lang, acceptLanguage);
  }

  @Get(':slug/p/:dishId')
  @ApiParam({ name: 'dishId', format: 'uuid' })
  @ApiOkResponse({ type: CartaDishShare, description: 'Link preview of a dish the carta lists; never carries a table.' })
  dish(@Param('slug') slug: string, @Param('dishId') dishId: string): Promise<CartaDishShare> {
    return this.carta.dish(slug, dishId);
  }
}
