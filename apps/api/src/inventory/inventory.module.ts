import { Module } from '@nestjs/common';
import { CountsService } from './counts.service';
import { FormulasService } from './formulas.service';
import {
  CountsController,
  FormulasController,
  InventoryCategoriesController,
  InventoryController,
  InventoryItemsController,
  InventoryLocationsController,
  MovementsController,
  ProductionTemplatesController,
  PurchaseOrdersController,
  SuppliersController,
  TransfersController,
} from './inventory.controller';
import { ItemsService } from './items.service';
import { ProductionTemplatesService } from './production-templates.service';
import { PurchasesService } from './purchases.service';
import { SalesService } from './sales.service';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [
    InventoryItemsController,
    InventoryCategoriesController,
    InventoryLocationsController,
    SuppliersController,
    MovementsController,
    PurchaseOrdersController,
    TransfersController,
    CountsController,
    FormulasController,
    InventoryController,
    ProductionTemplatesController,
  ],
  providers: [ItemsService, StockService, PurchasesService, CountsService, FormulasService, SalesService, ProductionTemplatesService, TransfersService],
  exports: [SalesService],
})
export class InventoryModule {}
