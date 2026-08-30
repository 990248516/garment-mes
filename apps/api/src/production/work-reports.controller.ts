import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { FactoryContextGuard } from '../context/factory-context.guard';
import { FactoryPermissionGuard, RequirePermission } from '../context/factory-permission.guard';
import { idempotencyKey } from './validation';
import { type PieceworkEntriesQuery, type PieceworkQuery, WorkReportsService } from './work-reports.service';

@Controller()
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class WorkReportsController {
  constructor(private readonly workReports: WorkReportsService) {}

  @Post('work-reports\\:start')
  @HttpCode(201)
  @RequirePermission('work-report:start')
  start(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.workReports.start(
      request.factoryId!,
      request.auth!.user.id,
      request.auth!.user.workerId,
      hasOverridePermission(request),
      idempotencyKey(requestId),
      body,
    );
  }

  @Post('work-reports/:workReportId\\:complete')
  @HttpCode(200)
  @RequirePermission('work-report:complete')
  complete(
    @Req() request: AuthenticatedRequest,
    @Param('workReportId') workReportId: string,
    @Headers('idempotency-key') requestId: string | string[] | undefined,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.workReports.complete(
      request.factoryId!,
      request.auth!.user.id,
      request.auth!.user.workerId,
      hasOverridePermission(request),
      idempotencyKey(requestId),
      workReportId,
      body,
    );
  }
}

@Controller('piecework-entries')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class PieceworkEntriesController {
  constructor(private readonly workReports: WorkReportsService) {}

  @Get()
  @RequirePermission('piecework:read')
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: PieceworkEntriesQuery,
  ): Promise<Record<string, unknown>> {
    return this.workReports.listPieceworkEntries(request.factoryId!, query);
  }
}

@Controller('me/piecework')
@UseGuards(AuthGuard, FactoryContextGuard, FactoryPermissionGuard)
export class MyPieceworkController {
  constructor(private readonly workReports: WorkReportsService) {}

  @Get()
  @RequirePermission('self:piecework:read')
  getMyPiecework(
    @Req() request: AuthenticatedRequest,
    @Query() query: PieceworkQuery,
  ): Promise<Record<string, unknown>> {
    return this.workReports.getMyPiecework(request.factoryId!, request.auth!.user.workerId, query);
  }
}

function hasOverridePermission(request: AuthenticatedRequest): boolean {
  const permissions = request.auth?.factoryPermissions[request.factoryId!] ?? [];
  return permissions.includes('work-report:override') || permissions.includes('*');
}
