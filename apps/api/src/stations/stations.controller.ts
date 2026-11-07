import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
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
  CreateStationRequest,
  createStationSchema,
  DeleteStationRequest,
  deleteStationSchema,
  SetRouteRequest,
  setRouteSchema,
  Station,
  StationRoutes,
  UpdateStationRequest,
  updateStationSchema,
} from './stations.dto';
import { StationsService } from './stations.service';

const ADMIN = 'admin';

@ApiTags('stations')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields; the body carries `code` for station refusals.' })
@Controller('stations')
export class StationsController {
  constructor(private readonly stations: StationsService) {}

  @Get()
  @ApiOkResponse({ type: [Station], description: 'Every staff member reads them (the kitchen screen filters by station). Prep stations first, then Caja.' })
  list(): Promise<Station[]> {
    return this.stations.list();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateStationRequest })
  @ApiCreatedResponse({ type: Station, description: 'The first prep station becomes the default one.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiConflictResponse({ description: '`station_name_taken`, `cashier_exists` or `too_many_stations` (20).' })
  create(@Body() body: unknown): Promise<Station> {
    return this.stations.create(parseInput(createStationSchema, body));
  }

  /** Declared before :id routes. */
  @Post('starter')
  @Roles(ADMIN)
  @ApiCreatedResponse({ type: [Station], description: 'Cocina (default), Barra and Caja.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiConflictResponse({ description: '`stations_exist`: the restaurant already has stations.' })
  createStarter(): Promise<Station[]> {
    return this.stations.createStarter();
  }

  @Get('routes')
  @Roles(ADMIN)
  @ApiOkResponse({ type: StationRoutes, description: 'Category routes, dish exceptions with the station each dish goes to now, and the dishes without a route.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  routes(): Promise<StationRoutes> {
    return this.stations.routes();
  }

  @Put('routes/categories/:id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiBody({ type: SetRouteRequest })
  @ApiNoContentResponse({ description: 'The category routes to the station (null clears it).' })
  @ApiNotFoundResponse({ description: '`category_not_found`.' })
  @ApiUnprocessableEntityResponse({ description: '`cashier_route` (Caja) or `station_invalid`.' })
  setCategoryRoute(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.stations.setCategoryRoute(parseInput(idParamSchema, id), parseInput(setRouteSchema, body).stationId);
  }

  @Put('routes/dishes/:id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiBody({ type: SetRouteRequest })
  @ApiNoContentResponse({ description: 'The dish exception (null: same as its category).' })
  @ApiNotFoundResponse({ description: '`dish_not_found`.' })
  @ApiUnprocessableEntityResponse({ description: '`cashier_route` (Caja) or `station_invalid`.' })
  setDishRoute(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.stations.setDishRoute(parseInput(idParamSchema, id), parseInput(setRouteSchema, body).stationId);
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateStationRequest })
  @ApiOkResponse({ type: Station })
  @ApiNotFoundResponse({ description: '`station_not_found`.' })
  @ApiConflictResponse({ description: '`station_name_taken`.' })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Station> {
    return this.stations.update(parseInput(idParamSchema, id), parseInput(updateStationSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiBody({ type: DeleteStationRequest, required: false })
  @ApiNoContentResponse({ description: 'Deleted after moving its categories, dish exceptions and sent lines to moveTo (the default passes to it).' })
  @ApiNotFoundResponse({ description: '`station_not_found`.' })
  @ApiConflictResponse({ description: '`cashier_station`: Caja cannot be deleted.' })
  @ApiUnprocessableEntityResponse({ description: '`move_required` (another prep station exists) or `target_invalid`.' })
  remove(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    return this.stations.remove(parseInput(idParamSchema, id), parseInput(deleteStationSchema, body).moveTo ?? null);
  }
}
