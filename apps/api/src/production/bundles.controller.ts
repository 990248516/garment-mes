import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { type BundleListQuery, type BundleTimelineQuery, BundlesService } from './bundles.service';
import { idempotencyKey } from './validation';

@Controller('cutting-beds')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class BundleGenerationController {
  constructor(private readonly bundles: BundlesService) {}

  @Post(':cuttingBedId/bundles\\:preview')
  @RequirePermission('bundle:generate')
  preview(
    @Req() request: AuthenticatedRequest,
    @Param('cuttingBedId') cuttingBedId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.bundles.preview(request.factoryId!, cuttingBedId, body);
  }

  @Post(':cuttingBedId/bundles\\:generate')
  @HttpCode(201)
  @RequirePermission('bundle:generate')
  generate(
    @Req() request: AuthenticatedRequest,
    @Param('cuttingBedId') cuttingBedId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.bundles.generate(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      cuttingBedId,
      body,
    );
  }
}

@Controller('bundles')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Post('resolve')
  @HttpCode(200)
  @RequirePermission('bundle:scan')
  resolve(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<Record<string, unknown>> {
    return this.bundles.resolve(request.factoryId!, request.auth!.user.workerId, body);
  }

  @Get(':bundleId/work-details')
  @RequirePermission('bundle:trace')
  workDetails(
    @Req() request: AuthenticatedRequest,
    @Param('bundleId') bundleId: string,
  ): Promise<Record<string, unknown>> {
    return this.bundles.workDetails(request.factoryId!, bundleId);
  }

  @Get(':bundleId/timeline')
  @RequirePermission('bundle:trace')
  timeline(
    @Req() request: AuthenticatedRequest,
    @Param('bundleId') bundleId: string,
    @Query() query: BundleTimelineQuery,
  ): Promise<Record<string, unknown>> {
    return this.bundles.timeline(request.factoryId!, bundleId, query);
  }

  @Get()
  @RequirePermission('bundle:read')
  list(@Req() request: AuthenticatedRequest, @Query() query: BundleListQuery): Promise<Record<string, unknown>> {
    return this.bundles.list(request.factoryId!, query);
  }
}
