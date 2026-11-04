import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
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
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  CreateStaffRequest,
  createStaffSchema,
  parseStaffInput,
  SetStaffPasswordRequest,
  setStaffPasswordSchema,
  StaffMember,
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
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOkResponse({ type: [StaffMember], description: "Every profile of the caller's restaurant, by name." })
  list(): Promise<StaffMember[]> {
    return this.staff.list();
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

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Login deleted; the profile and its sessions cascade.' })
  @ApiNotFoundResponse({ description: "Not a profile of the caller's restaurant." })
  remove(@Param('id') id: string): Promise<void> {
    return this.staff.remove(parseInput(idParamSchema, id));
  }
}
