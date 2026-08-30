import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { CuttingBedsService, type CuttingBedListQuery } from './cutting-beds.service';
import { idempotencyKey } from './validation';

@Controller('cutting-beds')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class CuttingBedsController {
  constructor(private readonly cuttingBeds: CuttingBedsService) {}

  @Get()
  @RequirePermission('cutting:read')
  list(@Req() request: AuthenticatedRequest, @Query() query: CuttingBedListQuery): Promise<Record<string, unknown>> {
    return this.cuttingBeds.list(request.factoryId!, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('cutting:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.cuttingBeds.create(request.factoryId!, request.auth!.user.id, idempotencyKey(requestId), body);
  }

  @Get(':cuttingBedId')
  @RequirePermission('cutting:read')
  get(@Req() request: AuthenticatedRequest, @Param('cuttingBedId') cuttingBedId: string): Promise<Record<string, unknown>> {
    return this.cuttingBeds.get(request.factoryId!, cuttingBedId);
  }
}
