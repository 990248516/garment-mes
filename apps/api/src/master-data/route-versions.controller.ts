import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { idempotencyKey } from '../production/validation';
import { RouteVersionsService, type RouteVersionListQuery } from './route-versions.service';

@Controller('route-versions')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class RouteVersionsController {
  constructor(private readonly routeVersions: RouteVersionsService) {}

  @Get()
  @RequirePermission('route:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: RouteVersionListQuery,
  ): Promise<Record<string, unknown>> {
    return this.routeVersions.list(request.factoryId!, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('route:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.routeVersions.create(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      body,
    );
  }

  @Post(':routeVersionId\\:publish')
  @HttpCode(200)
  @RequirePermission('route:publish')
  publish(
    @Req() request: AuthenticatedRequest,
    @Param('routeVersionId') routeVersionId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.routeVersions.publish(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      routeVersionId,
      body,
    );
  }

  @Post(':routeVersionId\\:clone')
  @HttpCode(201)
  @RequirePermission('route:write')
  clone(
    @Req() request: AuthenticatedRequest,
    @Param('routeVersionId') routeVersionId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
  ): Promise<Record<string, unknown>> {
    return this.routeVersions.clone(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      routeVersionId,
    );
  }

  @Get(':routeVersionId')
  @RequirePermission('route:read')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('routeVersionId') routeVersionId: string,
  ): Promise<Record<string, unknown>> {
    return this.routeVersions.get(request.factoryId!, routeVersionId);
  }

  @Put(':routeVersionId')
  @HttpCode(200)
  @RequirePermission('route:write')
  replace(
    @Req() request: AuthenticatedRequest,
    @Param('routeVersionId') routeVersionId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.routeVersions.replace(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      ifMatch,
      routeVersionId,
      body,
    );
  }
}
