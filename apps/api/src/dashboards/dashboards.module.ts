import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard } from '../context/factory-permission.guard';
import { ProductionOverviewController } from './production-overview.controller';
import { ProductionOverviewService } from './production-overview.service';

@Module({
  imports: [AuthModule],
  controllers: [ProductionOverviewController],
  providers: [ProductionOverviewService, FactoryContextGuard, FactoryPermissionGuard],
})
export class DashboardsModule {}
