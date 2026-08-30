import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import {
  FactoryPermissionGuard,
  RequirePermission,
} from '../context/factory-permission.guard';
import { ProductionOverviewService } from './production-overview.service';

@Controller('dashboards')
export class ProductionOverviewController {
  constructor(private readonly overview: ProductionOverviewService) {}

  @Get('production-overview')
  @RequirePermission('dashboard:production')
  @UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
  getOverview(
    @Req() request: AuthenticatedRequest,
    @Query('date') date?: string,
    @Query('workshopId') workshopId?: string,
    @Query('lineId') lineId?: string,
  ): Promise<Record<string, unknown>> {
    return this.overview.getOverview(request.factoryId!, { date, workshopId, lineId });
  }
}
