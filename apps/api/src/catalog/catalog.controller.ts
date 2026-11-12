import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
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
  Category,
  categoryListQuerySchema,
  CategoryOrderRequest,
  categoryOrderSchema,
  CreateSubcategoryRequest,
  createSubcategorySchema,
  MenuTree,
  Subcategory,
  subcategoryListQuerySchema,
  SubcategoryOrderRequest,
  subcategoryOrderSchema,
  UpdateSubcategoryRequest,
  updateSubcategorySchema,
  CreateCategoryRequest,
  createCategorySchema,
  CreateDishRequest,
  createDishSchema,
  CreatePromotionRequest,
  Dish,
  dishListQuerySchema,
  DishOrderRequest,
  dishOrderSchema,
  MENU_MESSAGES,
  MenuPublicationStatus,
  menuTreeQuerySchema,
  Promotion,
  PROMOTION_ERRORS_DESCRIPTION,
  promotionDishesSchema,
  PromotionsToday,
  promotionsTodayQuerySchema,
  PromotionWeekStats,
  SetPromotionDishesRequest,
  UpdateCategoryRequest,
  updateCategorySchema,
  UpdateDishRequest,
  updateDishSchema,
  UpdatePromotionRequest,
} from './catalog.dto';
import { CategoriesService } from './categories.service';
import { DishesService } from './dishes.service';
import { MenuService } from './menu.service';
import { DishModifierGroupIds, DishModifierGroupsRequest, dishModifierGroupsSchema } from './modifiers.dto';
import { ModifiersService } from './modifiers.service';
import { PromotionWeekStatsService } from './promotion-week-stats.service';
import { PromotionsService } from './promotions.service';
import { SubcategoriesService } from './subcategories.service';

const ADMIN = 'admin';

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('catalog/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'], description: 'Omitted: every category.' })
  @ApiOkResponse({ type: [Category], description: 'By sortOrder, then name.' })
  list(@Query() query: unknown): Promise<Category[]> {
    return this.categories.list(parseInput(categoryListQuerySchema, query).active);
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateCategoryRequest })
  @ApiCreatedResponse({ type: Category })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  create(@Body() body: unknown): Promise<Category> {
    return this.categories.create(parseInput(createCategorySchema, body));
  }

  @Put('order')
  @Roles(ADMIN)
  @ApiBody({ type: CategoryOrderRequest })
  @ApiOkResponse({ type: [Category], description: 'Every category after the reorder, by sortOrder, then name.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown category (another restaurant) or a repeated id; nothing is saved.' })
  reorder(@Body() body: unknown): Promise<Category[]> {
    return this.categories.reorder(parseInput(categoryOrderSchema, body).ids);
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateCategoryRequest })
  @ApiOkResponse({ type: Category })
  @ApiNotFoundResponse()
  update(@Param('id') id: string, @Body() body: unknown): Promise<Category> {
    return this.categories.update(parseInput(idParamSchema, id), parseInput(updateCategorySchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Category has dishes, or La categoría tiene subcategorías; elimínalas primero.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.categories.remove(parseInput(idParamSchema, id));
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields or unknown category.' })
@Controller('catalog/subcategories')
export class SubcategoriesController {
  constructor(private readonly subcategories: SubcategoriesService) {}

  @Get()
  @ApiQuery({ name: 'categoryId', required: false, type: String, description: 'Omitted: every category.' })
  @ApiQuery({ name: 'includeInactive', required: false, enum: ['true', 'false'], description: 'Admin only.' })
  @ApiOkResponse({
    type: [Subcategory],
    description: 'Active subcategories (all with includeInactive), by category order, then sortOrder and name.',
  })
  @ApiForbiddenResponse({ description: 'includeInactive by a non-admin.' })
  list(@Query() query: unknown, @Req() req: AuthenticatedRequest): Promise<Subcategory[]> {
    const { categoryId, includeInactive } = parseInput(subcategoryListQuerySchema, query);
    if (includeInactive === true && req.profile!.role !== ADMIN) {
      throw new ForbiddenException('Only an admin sees inactive subcategories');
    }
    return this.subcategories.list({ categoryId, includeInactive: includeInactive === true });
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateSubcategoryRequest })
  @ApiCreatedResponse({ type: Subcategory })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiConflictResponse({ description: 'Ya existe una subcategoría con ese nombre en la categoría' })
  create(@Body() body: unknown): Promise<Subcategory> {
    return this.subcategories.create(parseInput(createSubcategorySchema, body));
  }

  @Put('order')
  @Roles(ADMIN)
  @ApiBody({ type: SubcategoryOrderRequest })
  @ApiOkResponse({ type: [Subcategory], description: 'Every subcategory of the category after the reorder, inactive included.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown subcategory (another category or restaurant) or a repeated id; nothing is saved.' })
  reorder(@Body() body: unknown): Promise<Subcategory[]> {
    const { categoryId, ids } = parseInput(subcategoryOrderSchema, body);
    return this.subcategories.reorder(categoryId, ids);
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateSubcategoryRequest })
  @ApiOkResponse({ type: Subcategory })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'Ya existe una subcategoría con ese nombre en la categoría' })
  update(@Param('id') id: string, @Body() body: unknown): Promise<Subcategory> {
    return this.subcategories.update(parseInput(idParamSchema, id), parseInput(updateSubcategorySchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'La subcategoría tiene platos; muévelos primero' })
  remove(@Param('id') id: string): Promise<void> {
    return this.subcategories.remove(parseInput(idParamSchema, id));
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({
  description: 'Invalid input, unknown fields, unknown category or a subcategory outside the dish category (Spanish message).',
})
@Controller('catalog/dishes')
export class DishesController {
  constructor(
    private readonly dishes: DishesService,
    private readonly modifiers: ModifiersService,
  ) {}

  @Get()
  @ApiQuery({ name: 'categoryId', required: false, type: String })
  @ApiQuery({ name: 'subcategoryId', required: false, type: String })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiQuery({
    name: 'pricing',
    required: false,
    enum: ['promotions'],
    description: 'Add the automatic product promotion a line of each dish would be sent with now (price stays the list price).',
  })
  @ApiQuery({ name: 'channel', required: false, enum: ['dine_in', 'delivery'], description: 'With pricing=promotions; default dine_in.' })
  @ApiOkResponse({ type: [Dish] })
  list(@Query() query: unknown): Promise<Dish[]> {
    return this.dishes.list(parseInput(dishListQuerySchema, query));
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateDishRequest })
  @ApiCreatedResponse({ type: Dish })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  create(@Body() body: unknown): Promise<Dish> {
    return this.dishes.create(parseInput(createDishSchema, body));
  }

  @Put('order')
  @Roles(ADMIN)
  @ApiBody({ type: DishOrderRequest })
  @ApiOkResponse({ type: [Dish], description: 'Every dish of the group after the reorder, inactive included, by sortOrder, then name.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiUnprocessableEntityResponse({ description: 'Unknown dish (another group or restaurant) or a repeated id; nothing is saved.' })
  reorder(@Body() body: unknown): Promise<Dish[]> {
    const { categoryId, subcategoryId, ids } = parseInput(dishOrderSchema, body);
    return this.dishes.reorder({ categoryId, subcategoryId }, ids);
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateDishRequest })
  @ApiOkResponse({ type: Dish })
  @ApiNotFoundResponse()
  update(@Param('id') id: string, @Body() body: unknown): Promise<Dish> {
    return this.dishes.update(parseInput(idParamSchema, id), parseInput(updateDishSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.dishes.remove(parseInput(idParamSchema, id));
  }

  @Get(':id/modifier-groups')
  @Roles(ADMIN)
  @ApiOkResponse({ type: DishModifierGroupIds })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiNotFoundResponse()
  async modifierGroups(@Param('id') id: string): Promise<DishModifierGroupIds> {
    return { groupIds: await this.modifiers.dishGroupIds(parseInput(idParamSchema, id)) };
  }

  @Put(':id/modifier-groups')
  @Roles(ADMIN)
  @ApiBody({ type: DishModifierGroupsRequest })
  @ApiOkResponse({ type: DishModifierGroupIds, description: 'The new group set, atomically; position i is the order i.' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiNotFoundResponse()
  @ApiUnprocessableEntityResponse({ description: 'Grupo de modificadores desconocido (another restaurant) or a repeated id; nothing is saved.' })
  async setModifierGroups(@Param('id') id: string, @Body() body: unknown): Promise<DishModifierGroupIds> {
    const { groupIds } = parseInput(dishModifierGroupsSchema, body);
    return { groupIds: await this.modifiers.setDishGroups(parseInput(idParamSchema, id), groupIds) };
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields or unknown dish.' })
@Controller('catalog/promotions')
export class PromotionsController {
  constructor(
    private readonly promotions: PromotionsService,
    private readonly weekStats: PromotionWeekStatsService,
  ) {}

  @Get()
  @ApiOkResponse({ type: [Promotion], description: 'Newest first, with targets, combo groups, 30-day stats, schedule now, sentence and badge.' })
  list(): Promise<Promotion[]> {
    return this.promotions.list();
  }

  @Get('active')
  @ApiOkResponse({ type: [Promotion], description: 'Active and inside their dates now (restaurant timezone), oldest first.' })
  active(): Promise<Promotion[]> {
    return this.promotions.active();
  }

  @Get('today')
  @ApiQuery({ name: 'channel', required: false, enum: ['dine_in', 'delivery'], description: 'Default dine_in.' })
  @ApiOkResponse({
    type: PromotionsToday,
    description: 'For the terminals: the promotions applying now on the channel (with the end of the window), later today (with the start) and the others with why not; paused and ended ones are left out.',
  })
  today(@Query() query: unknown): Promise<PromotionsToday> {
    return this.promotions.today(parseInput(promotionsTodayQuerySchema, query).channel);
  }

  @Get('stats/week')
  @Roles(ADMIN)
  @ApiOkResponse({
    type: PromotionWeekStats,
    description: 'Paid orders from Monday at the business-day cut-off (restaurant timezone) through now: discount granted, its share of gross sales, and the sales and bills with a promotion.',
  })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  weekStatsNow(): Promise<PromotionWeekStats> {
    return this.weekStats.week();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreatePromotionRequest })
  @ApiCreatedResponse({ type: Promotion, description: 'The promotion with its targets and combo groups, saved in one transaction.' })
  @ApiUnprocessableEntityResponse({ description: PROMOTION_ERRORS_DESCRIPTION })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  create(@Body() body: unknown): Promise<Promotion> {
    return this.promotions.create(body);
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdatePromotionRequest })
  @ApiOkResponse({ type: Promotion, description: 'Omitted fields keep their value; the merged promotion is validated per kind. targets and comboGroups replace the stored ones when sent.' })
  @ApiUnprocessableEntityResponse({ description: PROMOTION_ERRORS_DESCRIPTION })
  @ApiNotFoundResponse()
  update(@Param('id') id: string, @Body() body: unknown): Promise<Promotion> {
    return this.promotions.update(parseInput(idParamSchema, id), body);
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'The promotion and its dish rows are deleted in one transaction.' })
  @ApiNotFoundResponse()
  remove(@Param('id') id: string): Promise<void> {
    return this.promotions.remove(parseInput(idParamSchema, id));
  }

  @Get(':id/dishes')
  @ApiOkResponse({ type: [Dish] })
  @ApiNotFoundResponse()
  dishes(@Param('id') id: string): Promise<Dish[]> {
    return this.promotions.dishes(parseInput(idParamSchema, id));
  }

  @Put(':id/dishes')
  @Roles(ADMIN)
  @ApiBody({ type: SetPromotionDishesRequest })
  @ApiOkResponse({ type: [Dish], description: 'The new dish set; replaces the previous one atomically.' })
  @ApiNotFoundResponse()
  setDishes(@Param('id') id: string, @Body() body: unknown): Promise<Dish[]> {
    return this.promotions.setDishes(parseInput(idParamSchema, id), parseInput(promotionDishesSchema, body).dishIds);
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@Controller('catalog/menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('tree')
  @ApiOkResponse({
    type: MenuTree,
    description:
      'The waiter and delivery step picker: active categories, active subcategories and active dishes (plus the active dishes without category in `uncategorized`), priced and with availability. Structure (order, names, colours, icons, category/subcategory flags) is the latest publication; price, availability, stock and modifier groups are live. A row added since is hidden until published, a deleted one drops out; never published = the live structure.',
  })
  @ApiQuery({ name: 'channel', required: false, enum: ['dine_in', 'delivery'], description: 'Channel of the dish promotion fields; default dine_in.' })
  tree(@Query() query: unknown): Promise<MenuTree> {
    return this.menu.tree(parseInput(menuTreeQuerySchema, query).channel);
  }

  @Get('draft')
  @Roles(ADMIN)
  @ApiOkResponse({ type: MenuTree, description: 'The tree from the live structure: what the next publication serves (admin menu editor preview).' })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  @ApiQuery({ name: 'channel', required: false, enum: ['dine_in', 'delivery'] })
  draft(@Query() query: unknown): Promise<MenuTree> {
    return this.menu.draft(parseInput(menuTreeQuerySchema, query).channel);
  }

  @Get('publication')
  @Roles(ADMIN)
  @ApiOkResponse({ type: MenuPublicationStatus })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  publication(): Promise<MenuPublicationStatus> {
    return this.menu.status();
  }

  // No @Roles: public.publish_menu() is the guard (42501 through RLS), answered in Spanish.
  @Post('publish')
  @ApiCreatedResponse({ type: MenuPublicationStatus, description: 'The live structure is now what waiters and delivery see; pendingChanges is 0.' })
  @ApiForbiddenResponse({ description: MENU_MESSAGES.publishForbidden })
  publish(): Promise<MenuPublicationStatus> {
    return this.menu.publish();
  }
}
