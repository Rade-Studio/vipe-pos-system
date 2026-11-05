import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
import { Roles } from '../auth/roles.decorator';
import { idParamSchema, parseInput } from '../common/validation';
import {
  Category,
  categoryListQuerySchema,
  CreateCategoryRequest,
  createCategorySchema,
  CreateDishRequest,
  createDishSchema,
  CreatePromotionRequest,
  createPromotionSchema,
  Dish,
  dishListQuerySchema,
  Promotion,
  promotionDishesSchema,
  SetPromotionDishesRequest,
  UpdateCategoryRequest,
  updateCategorySchema,
  UpdateDishRequest,
  updateDishSchema,
  UpdatePromotionRequest,
  updatePromotionSchema,
} from './catalog.dto';
import { CategoriesService } from './categories.service';
import { DishesService } from './dishes.service';
import { PromotionsService } from './promotions.service';

const ADMIN = 'admin';

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('catalog/categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'], description: 'Omitted: every category.' })
  @ApiOkResponse({ type: [Category] })
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
  @ApiConflictResponse({ description: 'Category has dishes.' })
  remove(@Param('id') id: string): Promise<void> {
    return this.categories.remove(parseInput(idParamSchema, id));
  }
}

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields or unknown category.' })
@Controller('catalog/dishes')
export class DishesController {
  constructor(private readonly dishes: DishesService) {}

  @Get()
  @ApiQuery({ name: 'categoryId', required: false, type: String })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiQuery({
    name: 'pricing',
    required: false,
    enum: ['promotions'],
    description: 'Apply the best promotion active now; discounted dishes carry the promotion fields.',
  })
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
}

@ApiTags('catalog')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields or unknown dish.' })
@Controller('catalog/promotions')
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiOkResponse({ type: [Promotion], description: 'Newest first.' })
  list(): Promise<Promotion[]> {
    return this.promotions.list();
  }

  @Get('active')
  @ApiOkResponse({ type: [Promotion], description: 'Active and inside their date window now (server clock).' })
  active(): Promise<Promotion[]> {
    return this.promotions.active();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreatePromotionRequest })
  @ApiCreatedResponse({ type: Promotion })
  @ApiForbiddenResponse({ description: 'Not an admin.' })
  create(@Body() body: unknown): Promise<Promotion> {
    return this.promotions.create(parseInput(createPromotionSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdatePromotionRequest })
  @ApiOkResponse({ type: Promotion })
  @ApiNotFoundResponse()
  update(@Param('id') id: string, @Body() body: unknown): Promise<Promotion> {
    return this.promotions.update(parseInput(idParamSchema, id), parseInput(updatePromotionSchema, body));
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
