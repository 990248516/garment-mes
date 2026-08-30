import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { WorkerAccountsService } from './worker-accounts.service';

@Controller('users')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class WorkerAccountsController {
  constructor(private readonly accounts: WorkerAccountsService) {}

  @Get()
  @RequirePermission('user:read')
  list(@Req() request: AuthenticatedRequest): Promise<Record<string, unknown>> {
    return this.accounts.list(request.factoryId!);
  }

  @Post()
  @HttpCode(201)
  @RequirePermission('user:write')
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.accounts.create(request.factoryId!, body);
  }

  @Patch(':userId/status')
  @RequirePermission('user:write')
  setStatus(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.accounts.setStatus(request.factoryId!, userId, body);
  }

  @Post(':userId/password:reset')
  @RequirePermission('user:write')
  resetPassword(
    @Req() request: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.accounts.resetPassword(request.factoryId!, userId, body);
  }
}
