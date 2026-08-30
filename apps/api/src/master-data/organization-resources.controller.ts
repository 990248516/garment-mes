import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { idempotencyKey } from '../production/validation';
import {
  OrganizationResourcesService,
  type OrganizationResourceListQuery,
} from './organization-resources.service';

@Controller('workshops')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class WorkshopsController {
  constructor(private readonly resources: OrganizationResourcesService) {}

  @Get()
  @RequirePermission('workshop:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: OrganizationResourceListQuery,
  ): Promise<Record<string, unknown>> {
    return this.resources.listWorkshops(request.factoryId!, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('workshop:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.resources.createWorkshop(request.factoryId!, idempotencyKey(requestId), body);
  }
}

@Controller('production-lines')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class ProductionLinesController {
  constructor(private readonly resources: OrganizationResourcesService) {}

  @Get()
  @RequirePermission('line:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: OrganizationResourceListQuery,
  ): Promise<Record<string, unknown>> {
    return this.resources.listProductionLines(request.factoryId!, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('line:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.resources.createProductionLine(request.factoryId!, idempotencyKey(requestId), body);
  }
}
