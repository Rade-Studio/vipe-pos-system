import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { CreateZoneRequest, createZoneSchema, UpdateZoneRequest, updateZoneSchema, Zone, zoneListQuerySchema } from './zones.dto';
import { ZonesService } from './zones.service';

const ADMIN = 'admin';

@ApiTags('zones')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('zones')
export class ZonesController {
  constructor(private readonly zones: ZonesService) {}

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, enum: ['true', 'false'], description: 'Admin only.' })
  @ApiOkResponse({ type: [Zone], description: 'Active zones (all with includeInactive), by sort order then name.' })
  @ApiForbiddenResponse({ description: 'includeInactive by a non-admin.' })
  list(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<Zone[]> {
    const includeInactive = parseInput(zoneListQuerySchema, query).includeInactive === true;
    if (includeInactive && req.profile!.role !== ADMIN) {
      throw new ForbiddenException('Only an admin sees inactive zones');
    }
    return this.zones.list(includeInactive);
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateZoneRequest })
  @ApiCreatedResponse({ type: Zone })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiConflictResponse({ description: 'Ya existe una zona con ese nombre' })
  create(@Body() body: unknown): Promise<Zone> {
    return this.zones.create(parseInput(createZoneSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateZoneRequest })
  @ApiOkResponse({ type: Zone })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Ya existe una zona con ese nombre' })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Zone> {
    return this.zones.update(parseInput(idParamSchema, id), parseInput(updateZoneSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'La zona tiene mesas; muévelas o elimínalas primero' })
  remove(@Param('id') id: string): Promise<void> {
    return this.zones.remove(parseInput(idParamSchema, id));
  }
}
