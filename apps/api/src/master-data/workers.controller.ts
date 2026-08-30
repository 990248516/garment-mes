import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { idempotencyKey } from '../production/validation';
import { WorkersService, type WorkerListQuery } from './workers.service';

@Controller('workers')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class WorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  @RequirePermission('worker:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: WorkerListQuery,
  ): Promise<Record<string, unknown>> {
    return this.workers.list(request.factoryId!, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('worker:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.workers.create(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      body,
    );
  }

  @Get(':workerId')
  @RequirePermission('worker:read')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
  ): Promise<Record<string, unknown>> {
    return this.workers.get(request.factoryId!, workerId);
  }

  @Patch(':workerId')
  @HttpCode(200)
  @RequirePermission('worker:write')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('workerId') workerId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.workers.update(
      request.factoryId!,
      request.auth!.user.id,
      idempotencyKey(requestId),
      ifMatch,
      workerId,
      body,
    );
  }
}
