import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import { DesktopAdminService } from './desktop-admin.service';
import { type DesktopRequest, DesktopDeviceGuard } from './desktop-device.guard';
import { DesktopDeviceService } from './desktop-device.service';
import { clientIpKey } from './desktop-identity';
import { DesktopPairingService } from './desktop-pairing.service';
import {
  AckRequest,
  ackSchema,
  ClaimRequest,
  claimSchema,
  DesktopDevice,
  DesktopPendingJob,
  DesktopPrinter,
  DesktopStation,
  DrawerEventRequest,
  drawerEventSchema,
  HeartbeatRequest,
  heartbeatSchema,
  HeartbeatResponse,
  PairingClaim,
  PairingCode,
  PairingCodeRequest,
  pairingCodeSchema,
  PairingPreview,
  pendingJobsQuerySchema,
  printersSchema,
  RenameDeviceRequest,
  renameDeviceSchema,
  UpdateManifest,
} from './desktop.dto';

const UNAUTHORIZED = '`device_unauthorized` (missing, unknown or not a `vdt_` token) or `device_revoked`.';

/** Unauthenticated pairing of the desktop app (F5a): keyed by the code, limited per client IP and globally. */
@ApiTags('desktop')
@Public()
@ApiNotFoundResponse({ description: '`pairing_code_invalid`: unknown code (counts as a wrong code).' })
@ApiGoneResponse({ description: '`pairing_code_expired`: expired or already claimed.' })
@ApiTooManyRequestsResponse({ description: '`pairing_attempts`: 5 wrong codes per IP or 100 overall in 10 minutes.' })
@ApiUnprocessableEntityResponse({ description: 'Not 6 digits or invalid device.' })
@Controller('desktop/pairing')
export class DesktopPairingController {
  constructor(private readonly pairing: DesktopPairingService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiBody({ type: PairingCodeRequest })
  @ApiOkResponse({ type: PairingPreview })
  preview(@Body() body: unknown, @Req() req: Request): Promise<PairingPreview> {
    return this.pairing.preview(parseInput(pairingCodeSchema, body).code, clientIpKey(req));
  }

  @Post('claim')
  @ApiBody({ type: ClaimRequest })
  @ApiCreatedResponse({ type: PairingClaim, description: 'The device token is returned only here.' })
  claim(@Body() body: unknown, @Req() req: Request): Promise<PairingClaim> {
    return this.pairing.claim(parseInput(claimSchema, body), clientIpKey(req));
  }
}

/** Desktop app routes (F5a): `Authorization: Bearer vdt_…`, never a staff cookie. */
@ApiTags('desktop')
@Public()
@UseGuards(DesktopDeviceGuard)
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: UNAUTHORIZED })
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('desktop')
export class DesktopDeviceController {
  constructor(private readonly devices: DesktopDeviceService) {}

  @Post('heartbeat')
  @HttpCode(200)
  @ApiBody({ type: HeartbeatRequest })
  @ApiOkResponse({ type: HeartbeatResponse })
  heartbeat(@Req() req: DesktopRequest, @Body() body: unknown): Promise<HeartbeatResponse> {
    return this.devices.heartbeat(req.desktopDevice!, parseInput(heartbeatSchema, body));
  }

  @Get('stations')
  @ApiOkResponse({ type: [DesktopStation] })
  stations(@Req() req: DesktopRequest): Promise<DesktopStation[]> {
    return this.devices.stations(req.desktopDevice!);
  }

  @Put('printers')
  @ApiBody({ type: [DesktopPrinter] })
  @ApiOkResponse({ type: [DesktopPrinter], description: 'Replaces the list; `station_invalid`, `too_many_printers` (422).' })
  printers(@Req() req: DesktopRequest, @Body() body: unknown): Promise<DesktopPrinter[]> {
    return this.devices.putPrinters(req.desktopDevice!, parseInput(printersSchema, body));
  }

  @Get('jobs/pending')
  @ApiOkResponse({ type: [DesktopPendingJob], description: 'Oldest first; `after` (job id) pages, `limit` 1..500.' })
  pending(@Req() req: DesktopRequest, @Query() query: unknown): Promise<DesktopPendingJob[]> {
    return this.devices.pending(req.desktopDevice!, parseInput(pendingJobsQuerySchema, query));
  }

  @Post('jobs/:id/ack')
  @HttpCode(204)
  @ApiBody({ type: AckRequest })
  @ApiNoContentResponse({ description: 'Acked for this device; repeating it is a no-op.' })
  @ApiNotFoundResponse({ description: '`job_not_found`: not a job the device receives (restaurant, station, created after pairing).' })
  ack(@Req() req: DesktopRequest, @Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.devices.ack(req.desktopDevice!, parseInput(idParamSchema, id), parseInput(ackSchema, body));
  }

  @Post('drawer-events')
  @HttpCode(204)
  @ApiBody({ type: DrawerEventRequest })
  @ApiNoContentResponse({ description: 'Recorded.' })
  drawer(@Req() req: DesktopRequest, @Body() body: unknown): Promise<void> {
    return this.devices.drawerEvent(req.desktopDevice!, parseInput(drawerEventSchema, body));
  }

  @Get('updates/:target/:currentVersion')
  @ApiOkResponse({
    type: UpdateManifest,
    description: 'Tauri dynamic manifest of the newest release of the channel; target `windows` (`windows-x86_64` is an alias).',
  })
  @ApiNoContentResponse({ description: 'Up to date, or DESKTOP_RELEASES_BASE_URL is not set.' })
  async update(
    @Req() req: DesktopRequest,
    @Param('target') target: string,
    @Param('currentVersion') currentVersion: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UpdateManifest | undefined> {
    const manifest = await this.devices.update(req.desktopDevice!, target, currentVersion);
    if (!manifest) {
      res.status(204);
      return undefined;
    }
    return manifest;
  }
}

/** Admin side of the desktop devices (F5a): pairing codes, list, rename, revoke. */
@ApiTags('desktop')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an admin.' })
@Controller('desktop')
export class DesktopAdminController {
  constructor(
    private readonly admin: DesktopAdminService,
    private readonly pairing: DesktopPairingService,
  ) {}

  @Post('pairing-codes')
  @ApiCreatedResponse({ type: PairingCode, description: '6 digits valid 10 minutes, single use.' })
  createCode(): Promise<PairingCode> {
    return this.pairing.createCode();
  }

  @Get('devices')
  @ApiOkResponse({ type: [DesktopDevice], description: 'Newest first, revoked devices included.' })
  list(): Promise<DesktopDevice[]> {
    return this.admin.list();
  }

  @Patch('devices/:id')
  @ApiBody({ type: RenameDeviceRequest })
  @ApiOkResponse({ type: DesktopDevice })
  @ApiNotFoundResponse({ description: '`device_not_found`.' })
  @ApiUnprocessableEntityResponse({ description: 'Name of 1..60 characters.' })
  rename(@Param('id') id: string, @Body() body: unknown): Promise<DesktopDevice> {
    return this.admin.rename(parseInput(idParamSchema, id), parseInput(renameDeviceSchema, body).name);
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Revoked (idempotent); the token answers 401 device_revoked from the next call.' })
  @ApiNotFoundResponse({ description: '`device_not_found`.' })
  revoke(@Param('id') id: string): Promise<void> {
    return this.admin.revoke(parseInput(idParamSchema, id));
  }
}
