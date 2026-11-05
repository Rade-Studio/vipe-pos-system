import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
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
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  AssignTableRequest,
  assignTableSchema,
  CreateTableRequest,
  createTableSchema,
  ReleaseTableRequest,
  releaseTableSchema,
  Table,
  UpdateTableRequest,
  updateTableSchema,
  Waiter,
} from './tables.dto';
import { TablesService } from './tables.service';

const ADMIN = 'admin';
/** Roles that seat and free tables from the waiter screen. */
const FLOOR = ['admin', 'waiter', 'cashier'];

@ApiTags('tables')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields or unknown waiter.' })
@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @ApiOkResponse({ type: [Table], description: 'Ordered by number, with the waiter name.' })
  list(): Promise<Table[]> {
    return this.tables.list();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateTableRequest })
  @ApiCreatedResponse({ type: Table })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  create(@Body() body: unknown): Promise<Table> {
    return this.tables.create(parseInput(createTableSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateTableRequest })
  @ApiOkResponse({ type: Table })
  @ApiNotFoundResponse()
  update(@Param('id') id: string, @Body() body: unknown): Promise<Table> {
    return this.tables.update(parseInput(idParamSchema, id), parseInput(updateTableSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Table has open orders.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.tables.remove(parseInput(idParamSchema, id));
  }

  @Post(':id/assign')
  @Roles(...FLOOR)
  @HttpCode(200)
  @ApiBody({ type: AssignTableRequest })
  @ApiOkResponse({ type: Table, description: 'The table is occupied by the waiter.' })
  @ApiNotFoundResponse()
  assign(@Param('id') id: string, @Body() body: unknown): Promise<Table> {
    return this.tables.assign(parseInput(idParamSchema, id), parseInput(assignTableSchema, body).waiterId);
  }

  @Post(':id/release')
  @Roles(...FLOOR)
  @HttpCode(200)
  @ApiBody({ type: ReleaseTableRequest, required: false })
  @ApiOkResponse({ type: Table, description: 'available, no waiter.' })
  @ApiConflictResponse({ description: 'kitchen, delivered, served or reserved, unless an admin sends force: true.' })
  @ApiNotFoundResponse()
  release(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Table> {
    const { force } = parseInput(releaseTableSchema, body);
    return this.tables.release(parseInput(idParamSchema, id), force === true, req.profile!.role);
  }
}

@ApiTags('staff')
@ApiCookieAuth()
@Controller('staff/waiters')
export class WaitersController {
  constructor(private readonly tables: TablesService) {}

  @Get()
  @ApiOkResponse({ type: [Waiter], description: 'Active waiters of the restaurant, by name.' })
  list(): Promise<Waiter[]> {
    return this.tables.waiters();
  }
}
