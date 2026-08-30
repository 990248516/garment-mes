import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { resolveDate } from '../dashboards/production-overview.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { bundleInclude, serializeBundle } from './serializers';
import {
  calendarDate,
  decodeCursor,
  encodeCursor,
  integer,
  objectBody,
  oneOf,
  optionalText,
  optionalUuid,
  pageLimit,
  text,
  uuid,
} from './validation';
import {
  money,
  pieceworkInclude,
  serializeBundleStep,
  serializePiecework,
  serializeWorkReport,
  workReportInclude,
} from './work-serializers';

const completionInclude = Prisma.validator<Prisma.WorkReportInclude>()({
  worker: true,
  bundleRouteStep: { include: { process: true } },
  bundle: { include: { routeSteps: { orderBy: { stepNo: 'asc' } } } },
});

interface WorkStartInput {
  bundleId: string;
  bundleRouteStepId: string;
  workshopId: string | null;
  productionLineId: string | null;
  deviceId: string | null;
  clientStartedAt: Date | null;
  skipPrerequisite: boolean;
  overrideReason: string | null;
}

interface DefectInput {
  defectCode: string;
  quantity: number;
  severity: 'MINOR' | 'MAJOR' | 'CRITICAL';
  notes: string | null;
  attachments: unknown[];
}

interface WorkCompleteInput {
  inputQty: number;
  goodQty: number;
  defectQty: number;
  missingQty: number;
  notes: string | null;
  clientCompletedAt: Date | null;
  deviceId: string | null;
  defects: DefectInput[];
  quantityOverride: boolean;
  overrideReason: string | null;
}

export interface PieceworkQuery {
  period?: unknown;
  from?: unknown;
  to?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

export interface PieceworkEntriesQuery {
  workerId?: unknown;
  bundleNo?: unknown;
  settlementStatus?: unknown;
  from?: unknown;
  to?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

@Injectable()
export class WorkReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async start(
    factoryId: string,
    actorUserId: string,
    workerId: string | null,
    canOverride: boolean,
    requestId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    if (!workerId) throw new ForbiddenException('Current account is not linked to a worker');
    const input = normalizeStart(body);
    if (input.skipPrerequisite && (!canOverride || !input.overrideReason)) {
      throw new ForbiddenException('Skipping prerequisites requires override permission and a reason');
    }
    try {
      return await this.idempotency.execute(factoryId, requestId, 'work-reports:start', body, 201, async (transaction) => {
        const [worker, step, activeWorkerReport] = await Promise.all([
          transaction.worker.findFirst({ where: { id: workerId, factoryId, status: 'ACTIVE', deletedAt: null } }),
          transaction.bundleRouteStep.findFirst({
            where: { id: input.bundleRouteStepId, bundleId: input.bundleId, factoryId },
            include: { bundle: true, process: true },
          }),
          transaction.workReport.findFirst({ where: { factoryId, workerId, status: 'STARTED' }, select: { id: true } }),
        ]);
        if (!worker) throw new ForbiddenException('Worker is not active in this factory');
        if (!step) throw new NotFoundException('Bundle route step not found');
        if (!['CREATED', 'IN_PROGRESS'].includes(step.bundle.status) || step.bundle.qrRevokedAt) {
          throw new ConflictException('Bundle is not available for work');
        }
        if (step.status !== 'READY') throw new ConflictException('Bundle route step is not ready');
        if (activeWorkerReport) throw new ConflictException('Worker already has an active task');

        const now = new Date();
        const skill = await transaction.workerSkill.findFirst({
          where: {
            workerId,
            processId: step.processId,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
        });
        if (!skill) throw new ForbiddenException('Worker is not qualified for this process');
        const incompletePrerequisite = await transaction.bundleRouteStep.findFirst({
          where: {
            bundleId: input.bundleId,
            stepNo: { lt: step.stepNo },
            isRequired: true,
            status: { notIn: ['COMPLETED', 'SKIPPED'] },
          },
          select: { id: true },
        });
        if (incompletePrerequisite && !input.skipPrerequisite) {
          throw new UnprocessableEntityException('A required prerequisite step is incomplete');
        }
        if (!canOverride) {
          if (input.workshopId && worker.workshopId && input.workshopId !== worker.workshopId) {
            throw new ForbiddenException('Worker cannot report work for another workshop');
          }
          if (input.productionLineId && worker.productionLineId && input.productionLineId !== worker.productionLineId) {
            throw new ForbiddenException('Worker cannot report work for another production line');
          }
        }

        const report = await transaction.workReport.create({
          data: {
            factoryId,
            requestId,
            bundleId: input.bundleId,
            bundleRouteStepId: input.bundleRouteStepId,
            workerId,
            workshopId: input.workshopId ?? worker.workshopId,
            productionLineId: input.productionLineId ?? worker.productionLineId,
            clientStartedAt: input.clientStartedAt,
            deviceId: input.deviceId,
            unitRateSnapshot: step.pieceRateSnapshot,
            createdBy: actorUserId,
          },
          include: workReportInclude,
        });
        await transaction.bundleRouteStep.update({
          where: { id: step.id },
          data: { status: 'STARTED', startedAt: now, version: { increment: 1 } },
        });
        await transaction.bundle.update({
          where: { id: input.bundleId },
          data: {
            status: 'IN_PROGRESS',
            currentStepNo: step.stepNo,
            currentWorkshopId: report.workshopId,
            currentLineId: report.productionLineId,
            version: { increment: 1 },
          },
        });
        await transaction.bundleEvent.create({
          data: {
            factoryId,
            bundleId: input.bundleId,
            eventType: 'STARTED',
            actorUserId,
            actorWorkerId: workerId,
            workReportId: report.id,
            payload: { bundleRouteStepId: step.id, processId: step.processId, processCode: step.processCodeSnapshot, processName: step.processNameSnapshot, overrideReason: input.overrideReason },
          },
        });
        const updatedBundle = await transaction.bundle.findUniqueOrThrow({
          where: { id: input.bundleId },
          include: bundleInclude,
        });
        return {
          workReport: serializeWorkReport(report),
          bundle: {
            ...serializeBundle(updatedBundle),
            routeSteps: updatedBundle.routeSteps.map(serializeBundleStep),
            activeWorkReport: serializeWorkReport(report),
            openQualityIssueCount: 0,
          },
          warnings: input.skipPrerequisite ? ['已由授权人员跳过前置工序。'] : [],
          serverTime: now.toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('This step, worker, or request already has active work');
      }
      throw error;
    }
  }

  async complete(
    factoryId: string,
    actorUserId: string,
    actorWorkerId: string | null,
    canOverride: boolean,
    requestId: string,
    workReportIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const workReportId = uuid(workReportIdValue, 'workReportId');
    const input = normalizeCompletion(body);
    validateQuantityConservation(input);
    if (input.quantityOverride && (!canOverride || !input.overrideReason)) {
      throw new ForbiddenException('Quantity override requires override permission and a reason');
    }

    return this.idempotency.execute(
      factoryId,
      requestId,
      `work-reports:${workReportId}:complete`,
      body,
      200,
      async (transaction) => {
        const report = await transaction.workReport.findFirst({
          where: { id: workReportId, factoryId },
          include: completionInclude,
        });
        if (!report) throw new NotFoundException('Work report not found');
        if (report.status !== 'STARTED') throw new ConflictException('Only started work may be completed');
        if (report.bundleRouteStep.status !== 'STARTED') throw new ConflictException('Bundle route step is not started');
        if (actorWorkerId !== report.workerId && !canOverride) {
          throw new ForbiddenException('Workers may complete only their own work');
        }

        const previousStep = [...report.bundle.routeSteps]
          .filter((step) => step.stepNo < report.bundleRouteStep.stepNo && step.isRequired)
          .sort((left, right) => right.stepNo - left.stepNo)[0];
        const expectedInput = previousStep?.goodQty ?? report.bundle.effectiveQty;
        if (input.inputQty !== expectedInput && !input.quantityOverride) {
          throw new UnprocessableEntityException(`inputQty must equal the available quantity ${expectedInput}`);
        }
        const inlineDefectQty = input.defects.reduce((total, defect) => total + defect.quantity, 0);
        if (inlineDefectQty > input.defectQty) {
          throw new UnprocessableEntityException('Inline defect quantities exceed defectQty');
        }

        const now = new Date();
        await transaction.workReport.update({
          where: { id: report.id },
          data: {
            status: 'COMPLETED',
            inputQty: input.inputQty,
            goodQty: input.goodQty,
            defectQty: input.defectQty,
            missingQty: input.missingQty,
            completedAt: now,
            clientCompletedAt: input.clientCompletedAt,
            deviceId: input.deviceId ?? report.deviceId,
            notes: input.notes,
          },
        });
        await transaction.bundleRouteStep.update({
          where: { id: report.bundleRouteStepId },
          data: {
            status: 'COMPLETED',
            inputQty: input.inputQty,
            goodQty: input.goodQty,
            defectQty: input.defectQty,
            missingQty: input.missingQty,
            completedAt: now,
            version: { increment: 1 },
          },
        });

        const nextStep = report.bundle.routeSteps
          .filter((step) => step.stepNo > report.bundleRouteStep.stepNo && step.isRequired && step.status === 'PENDING')
          .sort((left, right) => left.stepNo - right.stepNo)[0];
        if (nextStep) {
          await transaction.bundleRouteStep.update({
            where: { id: nextStep.id },
            data: { status: 'READY', version: { increment: 1 } },
          });
          await transaction.bundle.update({
            where: { id: report.bundleId },
            data: { status: 'IN_PROGRESS', currentStepNo: nextStep.stepNo, version: { increment: 1 } },
          });
        } else {
          await transaction.bundle.update({
            where: { id: report.bundleId },
            data: {
              status: 'COMPLETED',
              completedQty: input.goodQty,
              currentStepNo: null,
              version: { increment: 1 },
            },
          });
        }

        const qualityIssues = [];
        for (const defect of input.defects) {
          qualityIssues.push(await transaction.qualityIssue.create({
            data: {
              factoryId,
              bundleId: report.bundleId,
              bundleRouteStepId: report.bundleRouteStepId,
              workReportId: report.id,
              discoveredByWorkerId: report.workerId,
              defectCode: defect.defectCode,
              defectName: defect.defectCode,
              quantity: defect.quantity,
              severity: defect.severity,
              attachments: defect.attachments as Prisma.InputJsonValue,
              notes: defect.notes,
              createdBy: actorUserId,
            },
          }));
        }

        const piecework = input.goodQty > 0
          ? await transaction.pieceworkEntry.create({
              data: {
                factoryId,
                workReportId: report.id,
                workerId: report.workerId,
                processId: report.bundleRouteStep.processId,
                quantity: input.goodQty,
                unitRate: report.unitRateSnapshot,
                amount: report.unitRateSnapshot.mul(input.goodQty),
              },
              include: pieceworkInclude,
            })
          : null;
        await transaction.bundleEvent.create({
          data: {
            factoryId,
            bundleId: report.bundleId,
            eventType: 'COMPLETED',
            actorUserId,
            actorWorkerId: report.workerId,
            workReportId: report.id,
            payload: {
              bundleRouteStepId: report.bundleRouteStepId,
              processId: report.bundleRouteStep.processId,
              processCode: report.bundleRouteStep.processCodeSnapshot,
              processName: report.bundleRouteStep.processNameSnapshot,
              inputQty: input.inputQty,
              goodQty: input.goodQty,
              defectQty: input.defectQty,
              missingQty: input.missingQty,
              overrideReason: input.overrideReason,
            },
          },
        });

        if (!nextStep) {
          const remainingBundles = await transaction.bundle.count({
            where: {
              orderId: report.bundle.orderId,
              status: { notIn: ['COMPLETED', 'CANCELLED', 'SPLIT', 'MERGED'] },
            },
          });
          if (remainingBundles === 0) {
            await transaction.productionOrder.update({
              where: { id: report.bundle.orderId },
              data: { status: 'COMPLETED', updatedBy: actorUserId, version: { increment: 1 } },
            });
          }
        }

        const [updatedReport, updatedBundle] = await Promise.all([
          transaction.workReport.findUniqueOrThrow({ where: { id: report.id }, include: workReportInclude }),
          transaction.bundle.findUniqueOrThrow({ where: { id: report.bundleId }, include: bundleInclude }),
        ]);
        return {
          workReport: serializeWorkReport(updatedReport),
          bundle: {
            ...serializeBundle(updatedBundle),
            routeSteps: updatedBundle.routeSteps.map(serializeBundleStep),
            activeWorkReport: null,
            openQualityIssueCount: qualityIssues.length,
          },
          nextReadySteps: updatedBundle.routeSteps
            .filter((step) => step.status === 'READY')
            .map(serializeBundleStep),
          qualityIssues: qualityIssues.map((issue) => ({
            id: issue.id,
            factoryId: issue.factoryId,
            bundleId: issue.bundleId,
            bundleRouteStepId: issue.bundleRouteStepId,
            workReportId: issue.workReportId,
            defectCode: issue.defectCode,
            defectName: issue.defectName,
            quantity: issue.quantity,
            severity: issue.severity,
            status: issue.status,
            notes: issue.notes,
            attachments: issue.attachments,
            createdAt: issue.createdAt.toISOString(),
            updatedAt: issue.updatedAt.toISOString(),
          })),
          pieceworkEntry: piecework ? serializePiecework(piecework) : null,
          serverTime: now.toISOString(),
        };
      },
    );
  }

  async listPieceworkEntries(
    factoryId: string,
    query: PieceworkEntriesQuery,
  ): Promise<Record<string, unknown>> {
    const factory = await this.prisma.factory.findUnique({ where: { id: factoryId }, select: { timezone: true } });
    if (!factory) throw new NotFoundException('Factory not found');
    const workerId = optionalUuid(query.workerId, 'workerId');
    const bundleNo = optionalText(query.bundleNo, 'bundleNo', 80);
    const status = oneOf(query.settlementStatus, 'settlementStatus', ['PENDING', 'CONFIRMED', 'SETTLED', 'REVERSED'] as const);
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const from = query.from === undefined || query.from === '' ? undefined : calendarDate(query.from, 'from').toISOString().slice(0, 10);
    const to = query.to === undefined || query.to === '' ? undefined : calendarDate(query.to, 'to').toISOString().slice(0, 10);
    if (from && to && to < from) throw new UnprocessableEntityException('to must not precede from');
    const nextDay = to ? calendarDate(to, 'to') : undefined;
    nextDay?.setUTCDate(nextDay.getUTCDate() + 1);
    const createdAt = from || nextDay ? {
      ...(from ? { gte: zonedMidnight(from, factory.timezone) } : {}),
      ...(nextDay ? { lt: zonedMidnight(nextDay.toISOString().slice(0, 10), factory.timezone) } : {}),
    } : undefined;
    const where: Prisma.PieceworkEntryWhereInput = {
      factoryId,
      ...(workerId ? { workerId } : {}),
      ...(status ? { status } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(bundleNo ? { workReport: { bundle: { bundleNo: { contains: bundleNo, mode: 'insensitive' } } } } : {}),
    };
    const [entries, summaryEntries] = await Promise.all([
      this.prisma.pieceworkEntry.findMany({
        where,
        include: pieceworkInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.pieceworkEntry.findMany({
        where,
        select: { amount: true, quantity: true, workerId: true, workReport: { select: { bundleId: true } } },
      }),
    ]);
    const hasMore = entries.length > limit;
    const items = entries.slice(0, limit);
    const totalAmount = summaryEntries.reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
    return {
      items: items.map(serializePiecework),
      summary: {
        totalAmount: money(totalAmount),
        totalQuantity: summaryEntries.reduce((sum, entry) => sum + entry.quantity, 0),
        workerCount: new Set(summaryEntries.map((entry) => entry.workerId)).size,
        bundleCount: new Set(summaryEntries.map((entry) => entry.workReport.bundleId)).size,
        entryCount: summaryEntries.length,
      },
      page: {
        nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null,
        hasMore,
        total: summaryEntries.length,
      },
    };
  }

  async getMyPiecework(
    factoryId: string,
    workerId: string | null,
    query: PieceworkQuery,
    now = new Date(),
  ): Promise<Record<string, unknown>> {
    if (!workerId) throw new ForbiddenException('Current account is not linked to a worker');
    const factory = await this.prisma.factory.findUnique({ where: { id: factoryId }, select: { timezone: true } });
    if (!factory) throw new NotFoundException('Factory not found');
    const range = pieceworkRange(query, factory.timezone, now);
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const where: Prisma.PieceworkEntryWhereInput = {
      factoryId,
      workerId,
      createdAt: { gte: range.start, lt: range.endExclusive },
    };
    const [entries, total, reports] = await Promise.all([
      this.prisma.pieceworkEntry.findMany({
        where,
        include: pieceworkInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.pieceworkEntry.findMany({ where, select: { amount: true, status: true } }),
      this.prisma.workReport.aggregate({
        where: { factoryId, workerId, status: 'COMPLETED', completedAt: { gte: range.start, lt: range.endExclusive } },
        _sum: { goodQty: true, defectQty: true },
      }),
    ]);
    const hasMore = entries.length > limit;
    const items = entries.slice(0, limit);
    const sumStatus = (statuses: string[]) => total
      .filter((entry) => statuses.includes(entry.status))
      .reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
    return {
      workerId,
      period: { from: range.from, to: range.to },
      estimatedAmount: money(sumStatus(['PENDING'])),
      confirmedAmount: money(sumStatus(['CONFIRMED'])),
      settledAmount: money(sumStatus(['SETTLED'])),
      goodQty: reports._sum.goodQty ?? 0,
      defectQty: reports._sum.defectQty ?? 0,
      items: items.map(serializePiecework),
      page: {
        nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null,
        hasMore,
        total: total.length,
      },
    };
  }
}

export function validateQuantityConservation(input: Pick<WorkCompleteInput, 'inputQty' | 'goodQty' | 'defectQty' | 'missingQty'>): void {
  if (input.inputQty !== input.goodQty + input.defectQty + input.missingQty) {
    throw new UnprocessableEntityException('inputQty must equal goodQty + defectQty + missingQty');
  }
}

function normalizeStart(body: unknown): WorkStartInput {
  const value = objectBody(body);
  optionalText(value.workstationCode, 'workstationCode', 60);
  if (value.skipPrerequisite !== undefined && typeof value.skipPrerequisite !== 'boolean') {
    throw new UnprocessableEntityException('skipPrerequisite must be boolean');
  }
  return {
    bundleId: uuid(value.bundleId, 'bundleId'),
    bundleRouteStepId: uuid(value.bundleRouteStepId, 'bundleRouteStepId'),
    workshopId: optionalUuid(value.workshopId, 'workshopId'),
    productionLineId: optionalUuid(value.productionLineId, 'productionLineId'),
    deviceId: optionalText(value.deviceId, 'deviceId', 100),
    clientStartedAt: optionalTimestamp(value.clientStartedAt, 'clientStartedAt'),
    skipPrerequisite: value.skipPrerequisite === true,
    overrideReason: optionalText(value.overrideReason, 'overrideReason', 500),
  };
}

function normalizeCompletion(body: unknown): WorkCompleteInput {
  const value = objectBody(body);
  if (value.quantityOverride !== undefined && typeof value.quantityOverride !== 'boolean') {
    throw new UnprocessableEntityException('quantityOverride must be boolean');
  }
  const defects = value.defects === undefined ? [] : value.defects;
  if (!Array.isArray(defects)) throw new UnprocessableEntityException('defects must be an array');
  return {
    inputQty: integer(value.inputQty, 'inputQty'),
    goodQty: integer(value.goodQty, 'goodQty'),
    defectQty: integer(value.defectQty, 'defectQty'),
    missingQty: integer(value.missingQty, 'missingQty'),
    notes: optionalText(value.notes, 'notes', 2000),
    clientCompletedAt: optionalTimestamp(value.clientCompletedAt, 'clientCompletedAt'),
    deviceId: optionalText(value.deviceId, 'deviceId', 100),
    defects: defects.map((raw, index) => {
      const defect = objectBody(raw);
      const attachments = defect.attachments === undefined ? [] : defect.attachments;
      if (!Array.isArray(attachments)) throw new UnprocessableEntityException(`defects[${index}].attachments must be an array`);
      return {
        defectCode: text(defect.defectCode, `defects[${index}].defectCode`, 60),
        quantity: integer(defect.quantity, `defects[${index}].quantity`, 1),
        severity: oneOf(defect.severity, `defects[${index}].severity`, ['MINOR', 'MAJOR', 'CRITICAL'] as const) ?? 'MINOR',
        notes: optionalText(defect.notes, `defects[${index}].notes`, 500),
        attachments,
      };
    }),
    quantityOverride: value.quantityOverride === true,
    overrideReason: optionalText(value.overrideReason, 'overrideReason', 500),
  };
}

function optionalTimestamp(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new UnprocessableEntityException(`${name} must be an ISO date-time`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new UnprocessableEntityException(`${name} must be an ISO date-time`);
  return date;
}

function pieceworkRange(query: PieceworkQuery, timezone: string, now: Date) {
  const period = oneOf(query.period, 'period', ['TODAY', 'WEEK', 'MONTH', 'CUSTOM'] as const) ?? 'TODAY';
  const today = resolveDate(undefined, timezone, now);
  let from = today;
  let to = today;
  if (period === 'WEEK') {
    const date = calendarDate(today, 'today');
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    from = date.toISOString().slice(0, 10);
  } else if (period === 'MONTH') {
    from = `${today.slice(0, 7)}-01`;
  } else if (period === 'CUSTOM') {
    from = calendarDate(query.from, 'from').toISOString().slice(0, 10);
    to = calendarDate(query.to, 'to').toISOString().slice(0, 10);
    if (to < from) throw new UnprocessableEntityException('to must not precede from');
  }
  const nextDay = calendarDate(to, 'to');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    from,
    to,
    start: zonedMidnight(from, timezone),
    endExclusive: zonedMidnight(nextDay.toISOString().slice(0, 10), timezone),
  };
}

function zonedMidnight(date: string, timezone: string): Date {
  const target = Date.parse(`${date}T00:00:00.000Z`);
  let candidate = target;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(candidate));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(
      Number(values.year), Number(values.month) - 1, Number(values.day),
      Number(values.hour), Number(values.minute), Number(values.second),
    );
    candidate = target - (represented - candidate);
  }
  return new Date(candidate);
}
