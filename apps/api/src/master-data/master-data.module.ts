import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard } from '../context/factory-permission.guard';
import { IdempotencyService } from '../production/idempotency.service';
import { MasterDataController, ProcessPricingController, WorkerSkillsController } from './master-data.controller';
import { MasterDataService } from './master-data.service';
import { ProductionLinesController, WorkshopsController } from './organization-resources.controller';
import { OrganizationResourcesService } from './organization-resources.service';
import { ProcessPricingService } from './process-pricing.service';
import { WorkerAccountsController } from './worker-accounts.controller';
import { WorkerAccountsService } from './worker-accounts.service';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';
import { WorkerSkillsService } from './worker-skills.service';

@Module({
  imports: [AuthModule],
  controllers: [
    MasterDataController,
    ProcessPricingController,
    WorkshopsController,
    ProductionLinesController,
    WorkersController,
    WorkerAccountsController,
    WorkerSkillsController,
  ],
  providers: [
    MasterDataService,
    ProcessPricingService,
    OrganizationResourcesService,
    WorkersService,
    WorkerAccountsService,
    WorkerSkillsService,
    IdempotencyService,
    FactoryContextGuard,
    FactoryPermissionGuard,
  ],
})
export class MasterDataModule {}
