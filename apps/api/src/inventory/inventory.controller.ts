import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
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
import { CountsService } from './counts.service';
import { FormulasService } from './formulas.service';
import {
  AdjustStockInput,
  AdjustStockResult,
  adjustStockSchema,
  ApplyCountResult,
  batchListQuerySchema,
  BulkProduceInput,
  BulkProduceResult,
  bulkProduceSchema,
  CheckStockRequest,
  checkStockSchema,
  ConsumeOrderRequest,
  ConsumeOrderStockResult,
  consumeOrderSchema,
  CountLine,
  countLineSchema,
  CreateInventoryCategoryRequest,
  createCategorySchema,
  CreateItemRequest,
  createItemSchema,
  createLocationSchema,
  CreatePreparationInput,
  createPreparationSchema,
  CreatePurchaseOrderInput,
  createPurchaseOrderSchema,
  createSupplierSchema,
  DishAvailabilityRequest,
  dishAvailabilitySchema,
  DishStockCheckResult,
  Formula,
  FormulaIndex,
  InventoryCategory,
  InventoryCount,
  InventoryCountDetail,
  InventoryItem,
  InventoryLocation,
  InventoryLocationInput,
  InventoryOverview,
  InventoryTransfer,
  itemListQuerySchema,
  Lot,
  movementListQuerySchema,
  MovementPage,
  OpenCountInput,
  OpenCountResult,
  openCountSchema,
  overviewQuerySchema,
  PaymentStatusRequest,
  paymentStatusSchema,
  ProducePreparationInput,
  ProducePreparationResult,
  producePreparationSchema,
  ProductionBatch,
  ProductionTemplate,
  ProductionTemplateInput,
  createProductionTemplateSchema,
  updateProductionTemplateSchema,
  UpdateProductionTemplateRequest,
  PurchaseOrder,
  purchaseOrderListQuerySchema,
  PurchaseOrderStatusRequest,
  purchaseOrderStatusSchema,
  ReceivePurchaseOrderRequest,
  receivePurchaseOrderSchema,
  ReceivePurchaseResult,
  ReceiveTransferRequest,
  receiveTransferSchema,
  SaveFormulaInput,
  SaveFormulaResult,
  saveFormulaSchema,
  SetCountedQuantityRequest,
  Supplier,
  SupplierInput,
  TransferStockInput,
  TransferStockResult,
  transferStockSchema,
  TransferInput,
  transferListQuerySchema,
  transferSchema,
  UpdateInventoryCategoryRequest,
  UpdateInventoryLocationRequest,
  UpdateItemRequest,
  updateCategorySchema,
  updateItemSchema,
  updateLocationSchema,
  UpdatePurchaseOrderRequest,
  updatePurchaseOrderSchema,
  UpdateSupplierRequest,
  updateSupplierSchema,
} from './inventory.dto';
import { ItemsService } from './items.service';
import { ProductionTemplatesService } from './production-templates.service';
import { PurchasesService } from './purchases.service';
import { SalesService } from './sales.service';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

/** Inventory writes: the RLS write policies and most RPCs admit admin only. */
const ADMIN = 'admin';
/** Roles that sell: check_dishes_stock and consume_order_stock admit them (and re-check). */
const SELLERS = ['admin', 'cashier', 'waiter', 'delivery_operator'];
const RPC_ERRORS =
  'RPC errors keep their SQLSTATE in `code` and their message verbatim (`fn_name: ...`): 422 P0001 (rule; `details` = DETAIL, e.g. shortages JSON), 422 22023, 404 P0002, 403 42501.';
const READS = 'Any authenticated role; RLS limits some tables to admin (and kitchen), which then read [].';

const id = (value: string) => parseInput(idParamSchema, value);

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/items')
export class InventoryItemsController {
  constructor(
    private readonly items: ItemsService,
    private readonly stock: StockService,
  ) {}

  @Get()
  @ApiQuery({ name: 'kind', required: false, enum: ['raw', 'prep'] })
  @ApiQuery({ name: 'includeInactive', required: false, enum: ['true', 'false'], description: 'false = active only.' })
  @ApiOkResponse({ type: [InventoryItem], description: `By name. ${READS}` })
  list(@Query() query: unknown): Promise<InventoryItem[]> {
    return this.items.listItems(parseInput(itemListQuerySchema, query));
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateItemRequest })
  @ApiCreatedResponse({ type: InventoryItem, description: 'Insert plus optional opening stock in one transaction.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<InventoryItem> {
    return this.items.createItem(parseInput(createItemSchema, body));
  }

  @Post('preparations')
  @Roles(ADMIN)
  @ApiBody({ type: CreatePreparationInput })
  @ApiCreatedResponse({ type: InventoryItem, description: 'A kind=prep item, SKU PR-#### assigned by the server.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  createPreparation(@Body() body: unknown): Promise<InventoryItem> {
    return this.items.createPreparation(parseInput(createPreparationSchema, body));
  }

  @Get(':id')
  @ApiOkResponse({ type: InventoryItem })
  @ApiNotFoundResponse()
  get(@Param('id') itemId: string): Promise<InventoryItem> {
    return this.items.getItem(id(itemId));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateItemRequest })
  @ApiOkResponse({ type: InventoryItem })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') itemId: string, @Body() body: unknown): Promise<InventoryItem> {
    return this.items.updateItem(id(itemId), parseInput(updateItemSchema, body));
  }

  @Get(':id/lots')
  @ApiOkResponse({ type: [Lot], description: `FEFO order (expires_on ASC NULLS LAST, received_at). ${READS}` })
  lots(@Param('id') itemId: string): Promise<Lot[]> {
    return this.stock.listLots(id(itemId));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('inventory/item-categories')
export class InventoryCategoriesController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @ApiOkResponse({ type: [InventoryCategory], description: 'By name.' })
  list(): Promise<InventoryCategory[]> {
    return this.items.listCategories();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreateInventoryCategoryRequest })
  @ApiCreatedResponse({ type: InventoryCategory })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<InventoryCategory> {
    return this.items.createCategory(parseInput(createCategorySchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateInventoryCategoryRequest })
  @ApiOkResponse({ type: InventoryCategory })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') categoryId: string, @Body() body: unknown): Promise<InventoryCategory> {
    return this.items.updateCategory(id(categoryId), parseInput(updateCategorySchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Its items keep existing without category.' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  async remove(@Param('id') categoryId: string): Promise<void> {
    await this.items.deleteCategory(id(categoryId));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/locations')
export class InventoryLocationsController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @ApiOkResponse({ type: [InventoryLocation], description: 'Default first, then by name.' })
  list(): Promise<InventoryLocation[]> {
    return this.items.listLocations();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: InventoryLocationInput })
  @ApiCreatedResponse({ type: InventoryLocation })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<InventoryLocation> {
    return this.items.createLocation(parseInput(createLocationSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateInventoryLocationRequest })
  @ApiOkResponse({ type: InventoryLocation, description: 'isDefault: true moves the default here (trigger).' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') locationId: string, @Body() body: unknown): Promise<InventoryLocation> {
    return this.items.updateLocation(id(locationId), parseInput(updateLocationSchema, body));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input or unknown fields.' })
@Controller('inventory/suppliers')
export class SuppliersController {
  constructor(private readonly items: ItemsService) {}

  @Get()
  @ApiOkResponse({ type: [Supplier], description: `By name. ${READS}` })
  list(): Promise<Supplier[]> {
    return this.items.listSuppliers();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: SupplierInput })
  @ApiCreatedResponse({ type: Supplier })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<Supplier> {
    return this.items.createSupplier(parseInput(createSupplierSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateSupplierRequest })
  @ApiOkResponse({ type: Supplier })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') supplierId: string, @Body() body: unknown): Promise<Supplier> {
    return this.items.updateSupplier(id(supplierId), parseInput(updateSupplierSchema, body));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/movements')
export class MovementsController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @ApiQuery({ name: 'itemId', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'types', required: false, description: 'Comma-separated movement types.' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (local midnight of the restaurant timezone) or ISO date-time, inclusive.' })
  @ApiQuery({ name: 'to', required: false, description: 'Inclusive; a bare date means the whole local day of the restaurant timezone.' })
  @ApiQuery({ name: 'page', required: false, description: '1-based.' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Default 50, at most 500.' })
  @ApiOkResponse({ type: MovementPage, description: `Newest first. ${READS}` })
  list(@Query() query: unknown): Promise<MovementPage> {
    return this.stock.listMovements(parseInput(movementListQuerySchema, query));
  }

  @Post('adjust')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: AdjustStockInput })
  @ApiOkResponse({ type: AdjustStockResult, description: 'inventory_adjust.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  adjust(@Body() body: unknown): Promise<AdjustStockResult> {
    return this.stock.adjust(parseInput(adjustStockSchema, body));
  }

  @Post('transfer')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: TransferStockInput })
  @ApiOkResponse({ type: TransferStockResult, description: 'inventory_transfer (FEFO).' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  transfer(@Body() body: unknown): Promise<TransferStockResult> {
    return this.stock.transfer(parseInput(transferStockSchema, body));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, description: 'Comma-separated statuses.' })
  @ApiQuery({ name: 'supplierId', required: false })
  @ApiOkResponse({ type: [PurchaseOrder], description: `Newest first, lines and totals included. ${READS}` })
  list(@Query() query: unknown): Promise<PurchaseOrder[]> {
    return this.purchases.list(parseInput(purchaseOrderListQuerySchema, query));
  }

  @Get(':id')
  @ApiOkResponse({ type: PurchaseOrder })
  @ApiNotFoundResponse()
  get(@Param('id') orderId: string): Promise<PurchaseOrder> {
    return this.purchases.get(id(orderId));
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: CreatePurchaseOrderInput })
  @ApiCreatedResponse({ type: PurchaseOrder, description: 'Draft header and lines in one transaction.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<PurchaseOrder> {
    return this.purchases.create(parseInput(createPurchaseOrderSchema, body));
  }

  @Put(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdatePurchaseOrderRequest })
  @ApiOkResponse({ type: PurchaseOrder, description: 'Header replaced and line diff applied in one transaction.' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') orderId: string, @Body() body: unknown): Promise<PurchaseOrder> {
    return this.purchases.update(id(orderId), parseInput(updatePurchaseOrderSchema, body));
  }

  @Post(':id/status')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: PurchaseOrderStatusRequest })
  @ApiOkResponse({ type: PurchaseOrder })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  setStatus(@Param('id') orderId: string, @Body() body: unknown): Promise<PurchaseOrder> {
    return this.purchases.setStatus(id(orderId), parseInput(purchaseOrderStatusSchema, body).status);
  }

  @Post(':id/payment-status')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: PaymentStatusRequest })
  @ApiOkResponse({ type: PurchaseOrder })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  setPaymentStatus(@Param('id') orderId: string, @Body() body: unknown): Promise<PurchaseOrder> {
    return this.purchases.setPaymentStatus(id(orderId), parseInput(paymentStatusSchema, body).paymentStatus);
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Drafts only (422 P0001 otherwise).' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  async remove(@Param('id') orderId: string): Promise<void> {
    await this.purchases.remove(id(orderId));
  }

  @Post(':id/receive')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: ReceivePurchaseOrderRequest })
  @ApiOkResponse({ type: ReceivePurchaseResult, description: 'receive_purchase_order, then paymentStatus, in one transaction.' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  receive(@Param('id') orderId: string, @Body() body: unknown): Promise<ReceivePurchaseResult> {
    return this.purchases.receive(id(orderId), parseInput(receivePurchaseOrderSchema, body));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, description: 'Comma-separated statuses.' })
  @ApiQuery({ name: 'locationId', required: false, description: 'Origin or destination.' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD, local day of the restaurant, inclusive (created_at).' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD, inclusive.' })
  @ApiOkResponse({ type: [InventoryTransfer], description: `Newest first, lines included. Admin only by RLS. ${READS}` })
  list(@Query() query: unknown): Promise<InventoryTransfer[]> {
    return this.transfers.list(parseInput(transferListQuerySchema, query));
  }

  @Get(':id')
  @ApiOkResponse({ type: InventoryTransfer })
  @ApiNotFoundResponse()
  get(@Param('id') transferId: string): Promise<InventoryTransfer> {
    return this.transfers.get(id(transferId));
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: TransferInput })
  @ApiCreatedResponse({ type: InventoryTransfer, description: 'create_inventory_transfer: a draft; every line within the origin stock (422 P0001).' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<InventoryTransfer> {
    return this.transfers.create(parseInput(transferSchema, body));
  }

  @Put(':id')
  @Roles(ADMIN)
  @ApiBody({ type: TransferInput })
  @ApiOkResponse({ type: InventoryTransfer, description: 'update_inventory_transfer: drafts only (422 P0001), header and lines replaced.' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') transferId: string, @Body() body: unknown): Promise<InventoryTransfer> {
    return this.transfers.update(id(transferId), parseInput(transferSchema, body));
  }

  @Post(':id/send')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiOkResponse({
    type: InventoryTransfer,
    description: 'send_inventory_transfer: draft -> in_transit, the stock leaves the origin FEFO at once (all or nothing; 422 P0001 with `details` {shortages}).',
  })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  send(@Param('id') transferId: string): Promise<InventoryTransfer> {
    return this.transfers.send(id(transferId));
  }

  @Post(':id/receive')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: ReceiveTransferRequest })
  @ApiOkResponse({
    type: InventoryTransfer,
    description: 'receive_inventory_transfer: in_transit -> received | received_short; a shortfall needs a reason and is written off as merma en tránsito. Idempotent.',
  })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  receive(@Param('id') transferId: string, @Body() body: unknown): Promise<InventoryTransfer> {
    return this.transfers.receive(id(transferId), parseInput(receiveTransferSchema, body));
  }

  @Post(':id/cancel')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiOkResponse({ type: InventoryTransfer, description: 'cancel_inventory_transfer: draft | in_transit only; the stock in transit returns to the origin.' })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  cancel(@Param('id') transferId: string): Promise<InventoryTransfer> {
    return this.transfers.cancel(id(transferId));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/counts')
export class CountsController {
  constructor(private readonly counts: CountsService) {}

  @Get()
  @ApiOkResponse({ type: [InventoryCount], description: `Newest first. ${READS}` })
  list(): Promise<InventoryCount[]> {
    return this.counts.list();
  }

  @Get(':id')
  @ApiOkResponse({ type: InventoryCountDetail, description: 'Lines by item name (es).' })
  @ApiNotFoundResponse()
  get(@Param('id') countId: string): Promise<InventoryCountDetail> {
    return this.counts.get(id(countId));
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: OpenCountInput })
  @ApiCreatedResponse({ type: OpenCountResult, description: 'open_inventory_count.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  open(@Body() body: unknown): Promise<OpenCountResult> {
    return this.counts.open(parseInput(openCountSchema, body));
  }

  @Patch(':id/lines/:lineId')
  @Roles(ADMIN)
  @ApiBody({ type: SetCountedQuantityRequest })
  @ApiOkResponse({ type: CountLine })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  setCounted(@Param('id') countId: string, @Param('lineId') lineId: string, @Body() body: unknown): Promise<CountLine> {
    return this.counts.setCounted(id(countId), id(lineId), parseInput(countLineSchema, body).countedQuantity);
  }

  @Post(':id/apply')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiOkResponse({ type: ApplyCountResult, description: 'apply_inventory_count.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  apply(@Param('id') countId: string): Promise<ApplyCountResult> {
    return this.counts.apply(id(countId));
  }

  @Post(':id/cancel')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiOkResponse({ type: InventoryCount })
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  cancel(@Param('id') countId: string): Promise<InventoryCount> {
    return this.counts.cancel(id(countId));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: 'Invalid input, unknown fields or an unknown preparation in lines.' })
@Controller('inventory/production-templates')
export class ProductionTemplatesController {
  constructor(private readonly templates: ProductionTemplatesService) {}

  @Get()
  @Roles(ADMIN)
  @ApiOkResponse({ type: [ProductionTemplate], description: 'By name.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  list(): Promise<ProductionTemplate[]> {
    return this.templates.list();
  }

  @Post()
  @Roles(ADMIN)
  @ApiBody({ type: ProductionTemplateInput })
  @ApiCreatedResponse({ type: ProductionTemplate })
  @ApiConflictResponse({ description: 'A template with that name already exists.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  create(@Body() body: unknown): Promise<ProductionTemplate> {
    return this.templates.create(parseInput(createProductionTemplateSchema, body));
  }

  @Patch(':id')
  @Roles(ADMIN)
  @ApiBody({ type: UpdateProductionTemplateRequest })
  @ApiOkResponse({ type: ProductionTemplate })
  @ApiNotFoundResponse()
  @ApiConflictResponse({ description: 'A template with that name already exists.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  update(@Param('id') templateId: string, @Body() body: unknown): Promise<ProductionTemplate> {
    return this.templates.update(id(templateId), parseInput(updateProductionTemplateSchema, body));
  }

  @Delete(':id')
  @Roles(ADMIN)
  @HttpCode(204)
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  @ApiForbiddenResponse({ description: 'Not admin.' })
  remove(@Param('id') templateId: string): Promise<void> {
    return this.templates.remove(id(templateId));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiExtraModels(Formula)
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory/formulas')
export class FormulasController {
  constructor(private readonly formulas: FormulasService) {}

  @Get()
  @ApiOkResponse({ type: FormulaIndex, description: 'Every formula of the tenant by dish id and by prep id, with unitCost.' })
  list(): Promise<FormulaIndex> {
    return this.formulas.list();
  }

  @Put()
  @Roles(ADMIN)
  @ApiBody({ type: SaveFormulaInput })
  @ApiOkResponse({ type: SaveFormulaResult, description: 'save_formula (atomic replace).' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  save(@Body() body: unknown): Promise<SaveFormulaResult> {
    return this.formulas.save(parseInput(saveFormulaSchema, body));
  }
}

@ApiTags('inventory')
@ApiCookieAuth()
@ApiUnprocessableEntityResponse({ description: `Invalid input or unknown fields. ${RPC_ERRORS}` })
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly stock: StockService,
    private readonly sales: SalesService,
  ) {}

  @Get('batches')
  @ApiQuery({ name: 'itemId', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Default 100, at most 500.' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD, inclusive, on producedOn.' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD, inclusive, on producedOn; from..to spans at most 366 days.' })
  @ApiOkResponse({ type: [ProductionBatch], description: `Newest producedOn first, then newest registered. ${READS}` })
  batches(@Query() query: unknown): Promise<ProductionBatch[]> {
    return this.stock.listBatches(parseInput(batchListQuerySchema, query));
  }

  @Post('production')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: ProducePreparationInput })
  @ApiOkResponse({ type: ProducePreparationResult, description: 'produce_preparation; shortages answer 422 P0001 with `details`.' })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  produce(@Body() body: unknown): Promise<ProducePreparationResult> {
    return this.stock.produce(parseInput(producePreparationSchema, body));
  }

  @Post('production/bulk')
  @Roles(ADMIN)
  @HttpCode(200)
  @ApiBody({ type: BulkProduceInput })
  @ApiOkResponse({
    type: BulkProduceResult,
    description:
      'produce_preparations: every line in one transaction, all or nothing. A shortage of the combined demand answers 422 P0001 with `details` = [{item_id, name, ingredients:[{ingredient_id, name, unit, required, available, missing}]}].',
  })
  @ApiForbiddenResponse({ description: 'Not admin.' })
  produceMany(@Body() body: unknown): Promise<BulkProduceResult> {
    return this.stock.produceMany(parseInput(bulkProduceSchema, body));
  }

  @Get('overview')
  @ApiQuery({ name: 'days', required: false, description: 'Default 30 (1..365, checked by the RPC).' })
  @ApiOkResponse({ type: InventoryOverview, description: 'inventory_overview (admin; 403 42501 otherwise).' })
  overview(@Query() query: unknown): Promise<InventoryOverview> {
    return this.sales.overview(parseInput(overviewQuerySchema, query).days ?? 30);
  }

  @Post('check-stock')
  @Roles(...SELLERS)
  @HttpCode(200)
  @ApiBody({ type: CheckStockRequest })
  @ApiOkResponse({ type: DishStockCheckResult, description: 'check_dishes_stock; enabled false when inventory control is off.' })
  @ApiForbiddenResponse({ description: 'Not admin, cashier, waiter or delivery_operator.' })
  checkStock(@Body() body: unknown): Promise<DishStockCheckResult> {
    return this.sales.checkStock(parseInput(checkStockSchema, body).items);
  }

  @Post('consume')
  @Roles(...SELLERS)
  @HttpCode(200)
  @ApiBody({ type: ConsumeOrderRequest })
  @ApiOkResponse({ type: ConsumeOrderStockResult, description: 'consume_order_stock (idempotent).' })
  @ApiForbiddenResponse({ description: 'Not admin, cashier, waiter or delivery_operator.' })
  consume(@Body() body: unknown): Promise<ConsumeOrderStockResult> {
    return this.sales.consume(parseInput(consumeOrderSchema, body).orderId);
  }

  @Post('dish-availability')
  @Roles(...SELLERS)
  @HttpCode(200)
  @ApiBody({ type: DishAvailabilityRequest })
  @ApiOkResponse({
    schema: { type: 'object', additionalProperties: { type: 'boolean' } },
    description: 'dishId -> available (one portion, check_dishes_stock rule; all true when inventory control is off). Unknown ids are left out.',
  })
  @ApiForbiddenResponse({ description: 'Not admin, cashier, waiter or delivery_operator.' })
  availability(@Body() body: unknown): Promise<Record<string, boolean>> {
    return this.sales.availability(parseInput(dishAvailabilitySchema, body).dishIds);
  }
}
