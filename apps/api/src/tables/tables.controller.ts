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
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  AssignTableRequest,
  assignTableSchema,
  CreateTableRequest,
  createTableSchema,
  ReleaseTableRequest,
  releaseTableSchema,
  ReserveTableRequest,
  reserveTableSchema,
  SaveLayoutRequest,
  saveLayoutSchema,
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

  @Put('layout')
  @Roles(ADMIN)
  @ApiBody({ type: SaveLayoutRequest })
  @ApiOkResponse({ type: [Table], description: 'Every table after the save, ordered by number.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiUnprocessableEntityResponse({
    description: 'Unknown table (another restaurant), zone of another restaurant or invalid values; nothing is saved.',
  })
  saveLayout(@Body() body: unknown): Promise<Table[]> {
    return this.tables.saveLayout(parseInput(saveLayoutSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateTableRequest })
  @ApiOkResponse({ type: Table })
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description:
      'Status change refused: kitchen or served on a table without an open order, available or reserved while one is open.',
  })
  update(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Table> {
    return this.tables.update(parseInput(idParamSchema, id), parseInput(updateTableSchema, body), req.profile!.id);
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'La mesa tiene órdenes abiertas.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.tables.remove(parseInput(idParamSchema, id));
  }

  @Post(':id/assign')
  @Roles(...FLOOR)
  @HttpCode(200)
  @ApiBody({ type: AssignTableRequest })
  @ApiOkResponse({ type: Table, description: 'The table is occupied by the waiter; a reservation is cleared (seated).' })
  @ApiNotFoundResponse()
  assign(@Param('id') id: string, @Body() body: unknown): Promise<Table> {
    return this.tables.assign(parseInput(idParamSchema, id), parseInput(assignTableSchema, body).waiterId);
  }

  @Post(':id/reserve')
  @Roles(...FLOOR)
  @HttpCode(200)
  @ApiBody({ type: ReserveTableRequest })
  @ApiOkResponse({ type: Table, description: 'reserved under the name; the caller is reservedBy.' })
  @ApiConflictResponse({ description: 'table_not_available: not available or it has an open order.' })
  @ApiNotFoundResponse()
  reserve(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest): Promise<Table> {
    return this.tables.reserve(parseInput(idParamSchema, id), parseInput(reserveTableSchema, body), req.profile!.id);
  }

  @Post(':id/release')
  @Roles(...FLOOR)
  @HttpCode(200)
  @ApiBody({ type: ReleaseTableRequest, required: false })
  @ApiOkResponse({ type: Table, description: 'available, no waiter; a reservation is cancelled.' })
  @ApiConflictResponse({ description: 'kitchen, delivered or served, unless an admin sends force: true.' })
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
