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
  PurchaseOrdersController,
  SuppliersController,
} from './inventory.controller';
import { ItemsService } from './items.service';
import { PurchasesService } from './purchases.service';
import { SalesService } from './sales.service';
import { StockService } from './stock.service';

@Module({
  controllers: [
    InventoryItemsController,
    InventoryCategoriesController,
    InventoryLocationsController,
    SuppliersController,
    MovementsController,
    PurchaseOrdersController,
    CountsController,
    FormulasController,
    InventoryController,
  ],
  providers: [ItemsService, StockService, PurchasesService, CountsService, FormulasService, SalesService],
  exports: [SalesService],
})
export class InventoryModule {}
