import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
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
import { MasterDataService, type MasterListQuery } from './master-data.service';
import { ProcessPricingService } from './process-pricing.service';
import { WorkerSkillsService } from './worker-skills.service';

@Controller('master-data')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class MasterDataController {
  constructor(private readonly masterData: MasterDataService) {}

  @Get(':resource')
  @RequirePermission('master:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('resource') resource: string,
    @Query() query: MasterListQuery,
  ): Promise<Record<string, unknown>> {
    return this.masterData.list(request.factoryId!, resource, query);
  }

  @Post(':resource')
  @HttpCode(201)
  @RequirePermission('master:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Param('resource') resource: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.masterData.create(request.factoryId!, idempotencyKey(requestId), resource, body);
  }

  @Get(':resource/:resourceId')
  @RequirePermission('master:read')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('resource') resource: string,
    @Param('resourceId') resourceId: string,
  ): Promise<Record<string, unknown>> {
    return this.masterData.get(request.factoryId!, resource, resourceId);
  }

  @Patch(':resource/:resourceId')
  @HttpCode(200)
  @RequirePermission('master:write')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('resource') resource: string,
    @Param('resourceId') resourceId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.masterData.update(
      request.factoryId!,
      idempotencyKey(requestId),
      ifMatch,
      resource,
      resourceId,
      body,
    );
  }
}


@Controller('processes')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class ProcessPricingController {
  constructor(private readonly pricing: ProcessPricingService) {}

  @Post(':processId/adjust-rate')
  @HttpCode(200)
  @RequirePermission('piecework:adjust')
  adjustRate(
    @Req() request: AuthenticatedRequest,
    @Param('processId') processId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.pricing.adjustRate(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      processId,
      body,
    );
  }
}

@Controller('workers')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class WorkerSkillsController {
  constructor(private readonly workerSkills: WorkerSkillsService) {}

  @Get(':workerId/skills')
  @RequirePermission('worker:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
  ): Promise<Record<string, unknown>[]> {
    return this.workerSkills.list(request.factoryId!, workerId);
  }

  @Put(':workerId/skills')
  @HttpCode(200)
  @RequirePermission('worker:skill:write')
  replace(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>[]> {
    return this.workerSkills.replace(request.factoryId!, idempotencyKey(requestId), workerId, body);
  }
}
