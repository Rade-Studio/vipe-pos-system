import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { CommonModule } from './common/common.module';
import { EnvModule } from './config/env.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DbModule } from './db/db.module';
import { DeliveryModule } from './delivery/delivery.module';
import { DesktopModule } from './desktop/desktop.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PrintModule } from './print/print.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RegistersModule } from './registers/registers.module';
import { SettingsModule } from './settings/settings.module';
import { StationsModule } from './stations/stations.module';
import { StaffModule } from './staff/staff.module';
import { StorageModule } from './storage/storage.module';
import { TablesModule } from './tables/tables.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { ZonesModule } from './zones/zones.module';

@Module({
  imports: [
    EnvModule,
    CommonModule,
    DbModule,
    AuthModule,
    TenancyModule,
    HealthModule,
    RealtimeModule,
    CatalogModule,
    SettingsModule,
    OrdersModule,
    TablesModule,
    ZonesModule,
    PaymentsModule,
    RegistersModule,
    InventoryModule,
    PrintModule,
    DeliveryModule,
    StaffModule,
    DashboardModule,
    StorageModule,
    AuditModule,
    StationsModule,
    DesktopModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
