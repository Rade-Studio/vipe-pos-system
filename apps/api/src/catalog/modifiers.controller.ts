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
import {
  CreateModifierGroupRequest,
  createModifierGroupSchema,
  CreateModifierOptionRequest,
  createModifierOptionSchema,
  MODIFIER_MESSAGES,
  ModifierGroup,
  modifierGroupListQuerySchema,
  ModifierOption,
  UpdateModifierGroupRequest,
  updateModifierGroupSchema,
  UpdateModifierOptionRequest,
  updateModifierOptionSchema,
} from './modifiers.dto';
import { ModifiersService } from './modifiers.service';

const ADMIN = 'admin';

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields; the group rules in Spanish.' })
@Controller('catalog/modifier-groups')
export class ModifierGroupsController {
  constructor(private readonly modifiers: ModifiersService) {}

  @Get()
  @ApiQuery({ name: 'includeInactive', required: false, enum: ['true', 'false'], description: 'Admin only: inactive groups and options too.' })
  @ApiOkResponse({ type: [ModifierGroup], description: 'By sortOrder, then name, each with its options.' })
  @ApiForbiddenResponse({ description: 'includeInactive by a non-admin.' })
  list(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<ModifierGroup[]> {
    const { includeInactive } = parseInput(modifierGroupListQuerySchema, query);
    if (includeInactive === true && req.profile!.role !== ADMIN) {
      throw new ForbiddenException('Only an admin sees inactive modifier groups');
    }
    return this.modifiers.listGroups(includeInactive === true);
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateModifierGroupRequest })
  @ApiCreatedResponse({ type: ModifierGroup })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiConflictResponse({ description: MODIFIER_MESSAGES.duplicateGroup })
  create(@Body() body: unknown): Promise<ModifierGroup> {
    return this.modifiers.createGroup(parseInput(createModifierGroupSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateModifierGroupRequest })
  @ApiOkResponse({ type: ModifierGroup, description: 'With every option, inactive included.' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: MODIFIER_MESSAGES.duplicateGroup })
  update(@Param('id') id: string, @Body() body: unknown): Promise<ModifierGroup> {
    return this.modifiers.updateGroup(parseInput(idParamSchema, id), parseInput(updateModifierGroupSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The group, its options and its dish links; lines already sent keep their options.' })
  @ApiNotFoundResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.modifiers.removeGroup(parseInput(idParamSchema, id));
  }

  @Post(':id/options')
  @Roles(ADMIN)
  @ApiBody({ type: CreateModifierOptionRequest })
  @ApiCreatedResponse({ type: ModifierOption })
  @ApiNotFoundResponse({ description: 'Unknown group.' })
  @ApiConflictResponse({ description: MODIFIER_MESSAGES.duplicateOption })
  createOption(@Param('id') id: string, @Body() body: unknown): Promise<ModifierOption> {
    return this.modifiers.createOption(parseInput(idParamSchema, id), parseInput(createModifierOptionSchema, body));
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields, an unknown ingredient or an ingredient without quantity.' })
@Controller('catalog/modifier-options')
export class ModifierOptionsController {
  constructor(private readonly modifiers: ModifiersService) {}

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateModifierOptionRequest })
  @ApiOkResponse({ type: ModifierOption, description: 'A new price applies to the next lines; sent lines keep theirs.' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: MODIFIER_MESSAGES.duplicateOption })
  update(@Param('id') id: string, @Body() body: unknown): Promise<ModifierOption> {
    return this.modifiers.updateOption(parseInput(idParamSchema, id), parseInput(updateModifierOptionSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.modifiers.removeOption(parseInput(idParamSchema, id));
  }
}
