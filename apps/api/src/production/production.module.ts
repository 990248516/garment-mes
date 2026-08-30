import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard } from '../context/factory-permission.guard';
import { BundleGenerationController, BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';
import { CuttingBedsController } from './cutting-beds.controller';
import { CuttingBedsService } from './cutting-beds.service';
import { IdempotencyService } from './idempotency.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { MyPieceworkController, PieceworkEntriesController, WorkReportsController } from './work-reports.controller';
import { WorkReportsService } from './work-reports.service';

@Module({
  imports: [AuthModule],
  controllers: [
    OrdersController,
    CuttingBedsController,
    BundleGenerationController,
    BundlesController,
    WorkReportsController,
    PieceworkEntriesController,
    MyPieceworkController,
  ],
  providers: [
    OrdersService,
    CuttingBedsService,
    BundlesService,
    WorkReportsService,
    IdempotencyService,
    FactoryContextGuard,
    FactoryPermissionGuard,
  ],
})
export class ProductionModule {}
