import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { parsePinInput, setPinSchema } from '../auth/pins';
import { PinsService } from '../auth/pins.service';
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  CreateStaffRequest,
  createStaffSchema,
  parseStaffInput,
  SetStaffPasswordRequest,
  SetStaffPinRequest,
  setStaffPasswordSchema,
  StaffMember,
  StaffSupervisor,
  UpdateStaffRequest,
  updateStaffSchema,
} from './staff.dto';
import { StaffService } from './staff.service';

/**
 * Staff accounts, replacing the create-staff-account Edge Function and the
 * direct profiles writes of the staff screens. `GET /staff/waiters` stays in
 * the tables module.
 */
@ApiTags('staff')
@ApiCookieAuth()
@Roles('admin')
@ApiForbiddenResponse({ description: 'Not an active admin, or the target is an admin or the caller.' })
@ApiUnprocessableEntityResponse({ description: 'Invalid input; the message is the Spanish text the staff form shows.' })
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly pins: PinsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [StaffMember], description: "Every profile of the caller's restaurant, by name." })
  list(): Promise<StaffMember[]> {
    return this.staff.list();
  }

  @Get('supervisors')
  @Roles('admin', 'cashier', 'waiter', 'delivery_operator')
  @ApiOkResponse({
    type: [StaffSupervisor],
    description:
      "Active admins and cashiers of the caller's restaurant, by name (close a shared terminal, authorize a void). Also a terminal read route. pinLockedUntil only for an admin caller.",
  })
  supervisors(@Req() req: AuthenticatedRequest): Promise<StaffSupervisor[]> {
    return this.staff.supervisors(req.profile!.role);
  }

  @Post()
  @ApiBody({ type: CreateStaffRequest })
  @ApiCreatedResponse({ type: StaffMember, description: 'Login and profile created in one transaction.' })
  @ApiConflictResponse({ description: 'Ya existe una cuenta con ese correo electrónico' })
  create(@Body() body: unknown): Promise<StaffMember> {
    return this.staff.create(parseStaffInput(createStaffSchema, body));
  }

  @Patch(':id')
  @ApiBody({ type: UpdateStaffRequest })
  @ApiOkResponse({ type: StaffMember })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  update(@Param('id') id: string, @Body() body: unknown): Promise<StaffMember> {
    return this.staff.update(parseInput(idParamSchema, id), parseStaffInput(updateStaffSchema, body));
  }

  @Post(':id/password')
  @HttpCode(204)
  @ApiBody({ type: SetStaffPasswordRequest })
  @ApiNoContentResponse({ description: "Password replaced; the member's open sessions are revoked." })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  setPassword(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.staff.setPassword(parseInput(idParamSchema, id), parseStaffInput(setStaffPasswordSchema, body).password);
  }

  @Put(':id/pin')
  @HttpCode(204)
  @ApiBody({ type: SetStaffPinRequest })
  @ApiNoContentResponse({ description: 'PIN set or reset (stored as an argon2id hash); its lockout is cleared. Any profile of the restaurant, the admin included.' })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  setPin(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.pins.setForStaff(parseInput(idParamSchema, id), parsePinInput(setPinSchema, body).pin);
  }

  @Delete(':id/pin')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'PIN removed (no-op when the member has none).' })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  removePin(@Param('id') id: string): Promise<void> {
    return this.pins.clearForStaff(parseInput(idParamSchema, id));
  }

  @Delete(':id/pin/lock')
  @HttpCode(204)
  @ApiNoContentResponse({
    description: "Ends the member's PIN lockout early and clears its failed attempts; the PIN stays (no-op when not locked). Logged.",
  })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  unlockPin(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    return this.pins.unlockForStaff(req.profile!, parseInput(idParamSchema, id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Login deleted; the profile and its sessions cascade.' })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  remove(@Param('id') id: string): Promise<void> {
    return this.staff.remove(parseInput(idParamSchema, id));
  }
}
