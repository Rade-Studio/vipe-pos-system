import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import { UploadTicket } from '../storage/storage.dto';
import { StorageService } from '../storage/storage.service';
import {
  CARTA_ADMIN_MESSAGES as M,
  CartaAdmin,
  CartaAdminDaypart,
  CartaAdminRestaurant,
  CartaAdminSettings,
  CartaAdminTable,
  cartaAssetSchema,
  cartaDaypartsSchema,
  CartaDishDetails,
  cartaSettingsSchema,
  cartaSlugUpdateSchema,
  CartaTablesQr,
  CreateCartaAssetRequest,
  dishDetailsSchema,
  parseCartaAdminInput,
  ReplaceCartaDaypartsRequest,
  UpdateCartaSettingsRequest,
  UpdateCartaSlugRequest,
  UpdateDishDetailsRequest,
} from './carta-admin.dto';
import { CartaAdminService } from './carta-admin.service';

/** "Ajustes · Carta digital" (S17): admin only, UnitOfWork + RLS. */
@ApiTags('carta-admin')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an admin.' })
@Controller('carta-admin')
export class CartaAdminController {
  constructor(
    private readonly admin: CartaAdminService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOkResponse({ type: CartaAdmin, description: 'Everything the settings page shows, for the caller\'s restaurant.' })
  get(): Promise<CartaAdmin> {
    return this.admin.get();
  }

  @Put('settings')
  @ApiBody({ type: UpdateCartaSettingsRequest })
  @ApiOkResponse({ type: CartaAdminSettings, description: 'Created on the first save; omitted fields keep their value.' })
  @ApiUnprocessableEntityResponse({ description: 'One Spanish message for the first invalid field; nothing is written.' })
  updateSettings(@Body() body: unknown): Promise<CartaAdminSettings> {
    return this.admin.updateSettings(parseCartaAdminInput(cartaSettingsSchema, body));
  }

  @Put('dayparts')
  @ApiBody({ type: ReplaceCartaDaypartsRequest })
  @ApiOkResponse({ type: [CartaAdminDaypart], description: 'The new list; it replaced the previous one in one transaction.' })
  @ApiUnprocessableEntityResponse({ description: `${M.categories} | ${M.featuredDish} | ${M.daypartHours} | ...; the previous list stays.` })
  replaceDayparts(@Body() body: unknown): Promise<CartaAdminDaypart[]> {
    return this.admin.replaceDayparts(parseCartaAdminInput(cartaDaypartsSchema, body));
  }

  @Put('dishes/:dishId')
  @ApiBody({ type: UpdateDishDetailsRequest })
  @ApiOkResponse({ type: CartaDishDetails })
  @ApiNotFoundResponse({ description: M.dishNotFound })
  @ApiUnprocessableEntityResponse({ description: `${M.tags} | ${M.descriptionEn} | ${M.descriptionEnReviewed}` })
  updateDish(@Param('dishId') dishId: string, @Body() body: unknown): Promise<CartaDishDetails> {
    return this.admin.updateDish(parseInput(idParamSchema, dishId), parseCartaAdminInput(dishDetailsSchema, body));
  }

  @Post('tables/qr')
  @HttpCode(200)
  @ApiOkResponse({ type: CartaTablesQr, description: 'Every table got a new token in one transaction; the printed QRs stop working.' })
  async regenerateAll(): Promise<CartaTablesQr> {
    return { tables: await this.admin.regenerateAll() };
  }

  @Post('tables/:tableId/qr')
  @HttpCode(200)
  @ApiOkResponse({ type: CartaAdminTable, description: 'The table with its new token; the old QR stops working.' })
  @ApiNotFoundResponse({ description: M.tableNotFound })
  regenerateTable(@Param('tableId') tableId: string): Promise<CartaAdminTable> {
    return this.admin.regenerateTable(parseInput(idParamSchema, tableId));
  }

  @Put('slug')
  @ApiBody({ type: UpdateCartaSlugRequest })
  @ApiOkResponse({ type: CartaAdminRestaurant, description: 'The new public link; the old one and its printed QRs stop working.' })
  @ApiConflictResponse({ description: M.slugTaken })
  @ApiUnprocessableEntityResponse({ description: M.slug })
  updateSlug(@Body() body: unknown): Promise<CartaAdminRestaurant> {
    return this.admin.updateSlug(parseCartaAdminInput(cartaSlugUpdateSchema, body).slug);
  }

  @Post('assets')
  @ApiBody({ type: CreateCartaAssetRequest })
  @ApiCreatedResponse({ type: UploadTicket, description: 'Presigned PUT under <restaurantId>/carta/; save publicUrl as logoUrl or coverUrl.' })
  @ApiUnprocessableEntityResponse({ description: `${M.assetKind} | ${M.assetType} | ${M.assetSize}` })
  @ApiServiceUnavailableResponse({ description: 'Storage is not configured (no S3_* variables).' })
  createAsset(@Body() body: unknown): Promise<UploadTicket> {
    this.storage.assertConfigured();
    return this.admin.createAsset(parseCartaAdminInput(cartaAssetSchema, body));
  }
}
