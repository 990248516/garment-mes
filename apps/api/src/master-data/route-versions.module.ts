import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard } from '../context/factory-permission.guard';
import { IdempotencyService } from '../production/idempotency.service';
import { RouteVersionsController } from './route-versions.controller';
import { RouteVersionsService } from './route-versions.service';

@Module({
  imports: [AuthModule],
  controllers: [RouteVersionsController],
  providers: [
    RouteVersionsService,
    IdempotencyService,
    FactoryContextGuard,
    FactoryPermissionGuard,
  ],
})
export class RouteVersionsModule {}
