import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { BundlesService } from './bundles.service';
import { type OrderListQuery, OrdersService } from './orders.service';
import { idempotencyKey } from './validation';

@Controller('orders')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly bundles: BundlesService,
  ) {}

  @Get()
  @RequirePermission('order:read')
  list(@Req() request: AuthenticatedRequest, @Query() query: OrderListQuery): Promise<Record<string, unknown>> {
    return this.orders.list(request.factoryId!, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('order:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.orders.create(request.factoryId!, request.auth!.user.id, idempotencyKey(requestId), body);
  }

  @Post(':orderId\\:release')
  @HttpCode(200)
  @RequirePermission('order:release')
  release(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body?: unknown,
  ): Promise<Record<string, unknown>> {
    return this.orders.release(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      orderId,
      body,
    );
  }

  @Get(':orderId/bundle-work-details')
  @RequirePermission('bundle:trace')
  bundleWorkDetails(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
  ): Promise<Record<string, unknown>> {
    return this.bundles.orderWorkDetails(request.factoryId!, orderId);
  }

  @Get(':orderId')
  @RequirePermission('order:read')
  get(@Req() request: AuthenticatedRequest, @Param('orderId') orderId: string): Promise<Record<string, unknown>> {
    return this.orders.get(request.factoryId!, orderId);
  }

  @Patch(':orderId')
  @HttpCode(200)
  @RequirePermission('order:write')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.orders.update(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      ifMatch,
      orderId,
      body,
    );
  }
}
