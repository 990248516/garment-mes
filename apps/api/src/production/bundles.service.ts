import { createHash, randomBytes } from 'node:crypto';

import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { planBundles, type BundleLinePlanInput } from './bundle-planner';
import { IdempotencyService } from './idempotency.service';
import { bundleInclude, serializeBundle } from './serializers';
import { serializeBundleStep, serializeWorkReport, workReportInclude } from './work-serializers';
import {
  decodeCursor,
  encodeCursor,
  integer,
  objectBody,
  oneOf,
  optionalText,
  pageLimit,
  text,
  uuid,
} from './validation';

const BUNDLE_STATUSES = ['CREATED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'SPLIT', 'MERGED'] as const;
const generationBedInclude = Prisma.validator<Prisma.CuttingBedInclude>()({
  order: {
    include: {
      items: { include: { bundles: { select: { effectiveQty: true, status: true } } } },
    },
  },
  bundles: { select: { bundleSeq: true } },
});
const generationRouteInclude = Prisma.validator<Prisma.RouteVersionInclude>()({
  steps: { orderBy: { stepNo: 'asc' }, include: { process: true } },
});
const bundleWorkDetailInclude = Prisma.validator<Prisma.BundleInclude>()({
  order: { include: { style: true } },
  orderItem: { include: { color: true, size: true } },
  cuttingBed: true,
  routeVersion: { select: { versionNo: true } },
  routeSteps: {
    orderBy: { stepNo: 'asc' },
    include: {
      workReports: {
        orderBy: { startedAt: 'asc' },
        include: { worker: true, pieceworkEntries: { orderBy: { createdAt: 'asc' } } },
      },
    },
  },
});
type BundleWorkDetailRecord = Prisma.BundleGetPayload<{ include: typeof bundleWorkDetailInclude }>;
type GenerationClient = Pick<Prisma.TransactionClient, 'cuttingBed' | 'routeVersion'>;

interface GenerationLineInput {
  orderItemId: string;
  standardBundleQty: number;
  quantityToAllocate: number | null;
  allowTailBundle: boolean;
  authorizedOverproductionQty: number;
  overproductionReason: string | null;
}

interface GenerationInput {
  routeVersionId: string;
  bundleNoPrefix: string | null;
  lines: GenerationLineInput[];
}

export interface BundleListQuery {
  cursor?: unknown;
  limit?: unknown;
  q?: unknown;
  orderId?: unknown;
  cuttingBedId?: unknown;
  bundleStatus?: unknown;
  processId?: unknown;
  workshopId?: unknown;
  lineId?: unknown;
  stalledMinutesGte?: unknown;
}

export interface BundleTimelineQuery {
  cursor?: unknown;
  limit?: unknown;
}

interface TimelineProcessSnapshot {
  processCode: string;
  processName: string;
}

function timelineRouteStepId(payload: Prisma.JsonValue): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = (payload as Prisma.JsonObject).bundleRouteStepId;
  return typeof value === 'string' ? value : null;
}

export function enrichBundleEventPayload(
  payload: Prisma.JsonValue,
  processSnapshots: ReadonlyMap<string, TimelineProcessSnapshot>,
): Prisma.JsonValue {
  const routeStepId = timelineRouteStepId(payload);
  if (!routeStepId || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const snapshot = processSnapshots.get(routeStepId);
  if (!snapshot) return payload;
  const record = payload as Prisma.JsonObject;
  return {
    ...record,
    processCode: typeof record.processCode === 'string' ? record.processCode : snapshot.processCode,
    processName: typeof record.processName === 'string' ? record.processName : snapshot.processName,
  };
}

@Injectable()
export class BundlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async resolve(factoryId: string, workerId: string | null, body: unknown): Promise<Record<string, unknown>> {
    const value = objectBody(body);
    const code = text(value.code, 'code', 80, 4);
    optionalText(value.deviceId, 'deviceId', 100);
    const bundle = await this.prisma.bundle.findFirst({
      where: {
        factoryId,
        OR: [
          { shortCode: { equals: code, mode: 'insensitive' } },
          { bundleNo: { equals: code, mode: 'insensitive' } },
        ],
      },
      include: bundleInclude,
    });
    if (!bundle) throw new NotFoundException('Bundle not found');
    if (bundle.qrRevokedAt || ['CANCELLED', 'SPLIT', 'MERGED'].includes(bundle.status)) {
      throw new GoneException('Bundle or QR identity is no longer active');
    }

    const now = new Date();
    const [skills, activeReport, openQualityIssueCount] = await Promise.all([
      workerId
        ? this.prisma.workerSkill.findMany({
            where: {
              workerId,
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
            },
          })
        : [],
      this.prisma.workReport.findFirst({
        where: { bundleId: bundle.id, status: 'STARTED' },
        include: workReportInclude,
      }),
      this.prisma.qualityIssue.count({
        where: { bundleId: bundle.id, status: { notIn: ['CLOSED', 'SCRAPPED'] } },
      }),
    ]);
    const skillByProcess = new Map(skills.map((skill) => [skill.processId, skill.skillLevel]));
    const eligibleOperations = bundle.routeSteps
      .filter((step) => step.status === 'READY' && skillByProcess.has(step.processId))
      .map((step) => ({
        bundleRouteStepId: step.id,
        processId: step.processId,
        processCode: step.processCodeSnapshot,
        processName: step.processNameSnapshot,
        skillLevel: skillByProcess.get(step.processId)!,
        status: step.status,
        blockedReason: bundle.blockedReason,
        unitRate: step.pieceRateSnapshot.toFixed(4),
        estimatedAmount: step.pieceRateSnapshot.mul(bundle.effectiveQty).toFixed(4),
      }));
    return {
      bundle: {
        ...serializeBundle(bundle),
        routeSteps: bundle.routeSteps.map(serializeBundleStep),
        activeWorkReport: activeReport ? serializeWorkReport(activeReport) : null,
        openQualityIssueCount,
      },
      eligibleOperations,
      history: bundle.routeSteps
        .filter((step) => ['COMPLETED', 'SKIPPED'].includes(step.status))
        .map(serializeBundleStep),
      warnings: [
        ...(bundle.status === 'BLOCKED' ? [`扎包已阻塞：${bundle.blockedReason ?? '未提供原因'}`] : []),
        ...(!workerId ? ['当前账号未绑定员工，不能开工。'] : []),
      ],
      serverTime: now.toISOString(),
    };
  }

  async preview(factoryId: string, cuttingBedIdValue: unknown, body: unknown): Promise<Record<string, unknown>> {
    const cuttingBedId = uuid(cuttingBedIdValue, 'cuttingBedId');
    const input = normalizeGeneration(body);
    const prepared = await prepareGeneration(this.prisma, factoryId, cuttingBedId, input);
    return previewResponse(prepared.plans, prepared.warnings);
  }

  async generate(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    cuttingBedIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const cuttingBedId = uuid(cuttingBedIdValue, 'cuttingBedId');
    const input = normalizeGeneration(body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        `cutting-beds:${cuttingBedId}:bundles:generate`,
        body,
        201,
        async (transaction) => {
          const prepared = await prepareGeneration(transaction, factoryId, cuttingBedId, input);
          const bundles: Record<string, unknown>[] = [];
          const firstStepNo = prepared.route.steps[0]?.stepNo ?? null;
          for (const plan of prepared.plans) {
            const prefix = input.bundleNoPrefix ?? prepared.bed.bedNo;
            const bundleNo = `${prefix}-${String(plan.bundleSeq).padStart(3, '0')}`;
            if (bundleNo.length > 80) throw new UnprocessableEntityException('Generated bundleNo exceeds 80 characters');
            const shortCode = randomBytes(6).toString('hex').slice(0, 10).toUpperCase();
            const bundle = await transaction.bundle.create({
              data: {
                factoryId,
                orderId: prepared.bed.orderId,
                orderItemId: plan.orderItemId,
                cuttingBedId,
                routeVersionId: input.routeVersionId,
                bundleNo,
                bundleSeq: plan.bundleSeq,
                shortCode,
                qrTokenHash: createHash('sha256').update(shortCode).digest('hex'),
                plannedQty: plan.plannedQty,
                effectiveQty: plan.plannedQty,
                currentStepNo: firstStepNo,
                createdBy: actorUserId,
                routeSteps: {
                  create: prepared.route.steps.map((step, index) => ({
                    factoryId,
                    sourceRouteStepId: step.id,
                    stepNo: step.stepNo,
                    processId: step.processId,
                    processCodeSnapshot: step.process.code,
                    processNameSnapshot: step.process.name,
                    isRequired: step.isRequired,
                    isQualityGate: step.isQualityGate,
                    standardSeconds: step.standardSeconds,
                    pieceRateSnapshot: step.pieceRate ?? step.process.defaultPieceRate,
                    status: index === 0 ? 'READY' : 'PENDING',
                  })),
                },
                events: {
                  create: {
                    factoryId,
                    eventType: 'CREATED',
                    actorUserId,
                    payload: {
                      cuttingBedId,
                      routeVersionId: input.routeVersionId,
                      plannedQty: plan.plannedQty,
                      isTail: plan.isTail,
                    },
                  },
                },
              },
              include: bundleInclude,
            });
            bundles.push(serializeBundle(bundle));
          }
          await transaction.cuttingBed.update({ where: { id: cuttingBedId }, data: { status: 'RELEASED' } });
          if (prepared.bed.order.status === 'RELEASED') {
            await transaction.productionOrder.update({ where: { id: prepared.bed.orderId }, data: { status: 'IN_PROGRESS', updatedBy: actorUserId } });
          }
          return {
            bundleCount: bundles.length,
            totalQty: prepared.plans.reduce((total, plan) => total + plan.plannedQty, 0),
            bundles,
            serverTime: new Date().toISOString(),
          };
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Bundle sequence, number, short code, or idempotency key already exists');
      }
      throw error;
    }
  }

  async workDetails(factoryId: string, bundleIdValue: unknown): Promise<Record<string, unknown>> {
    const bundleId = uuid(bundleIdValue, 'bundleId');
    const bundle = await this.prisma.bundle.findFirst({
      where: { id: bundleId, factoryId },
      include: bundleWorkDetailInclude,
    });
    if (!bundle) throw new NotFoundException('Bundle not found');
    if (bundle.status !== 'COMPLETED') throw new ConflictException('Only completed bundles can be exported');
    return serializeBundleWorkDetail(bundle);
  }

  async orderWorkDetails(factoryId: string, orderIdValue: unknown): Promise<Record<string, unknown>> {
    const orderId = uuid(orderIdValue, 'orderId');
    const order = await this.prisma.productionOrder.findFirst({
      where: { id: orderId, factoryId },
      include: {
        style: true,
        bundles: {
          where: { status: { notIn: ['CANCELLED', 'SPLIT', 'MERGED'] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: bundleWorkDetailInclude,
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.bundles.length === 0) throw new ConflictException('The order has no exportable bundles');
    const completedBundleCount = order.bundles.filter((bundle) => bundle.status === 'COMPLETED').length;
    if (completedBundleCount !== order.bundles.length) {
      throw new ConflictException(
        `All order bundles must be completed before export (${completedBundleCount}/${order.bundles.length})`,
      );
    }
    return {
      order: {
        id: order.id,
        orderNo: order.orderNo,
        status: order.status,
        styleCode: order.style.code,
        styleName: order.style.name,
        bundleCount: order.bundles.length,
        completedBundleCount,
        totalEffectiveQty: order.bundles.reduce((total, bundle) => total + bundle.effectiveQty, 0),
        totalCompletedQty: order.bundles.reduce((total, bundle) => total + bundle.completedQty, 0),
      },
      bundles: order.bundles.map(serializeBundleWorkDetail),
    };
  }

  async timeline(factoryId: string, bundleIdValue: unknown, query: BundleTimelineQuery): Promise<Record<string, unknown>> {
    const bundleId = uuid(bundleIdValue, 'bundleId');
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const bundle = await this.prisma.bundle.findFirst({ where: { id: bundleId, factoryId }, select: { id: true } });
    if (!bundle) throw new NotFoundException('Bundle not found');

    const records = await this.prisma.bundleEvent.findMany({
      where: { factoryId, bundleId },
      orderBy: [{ eventAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    const routeStepIds = [...new Set(items.flatMap((event) => {
      const routeStepId = timelineRouteStepId(event.payload);
      return routeStepId ? [routeStepId] : [];
    }))];
    const [users, workers, routeSteps] = await Promise.all([
      this.prisma.appUser.findMany({
        where: { id: { in: items.flatMap((event) => event.actorUserId ? [event.actorUserId] : []) } },
        select: { id: true, displayName: true },
      }),
      this.prisma.worker.findMany({
        where: { id: { in: items.flatMap((event) => event.actorWorkerId ? [event.actorWorkerId] : []) } },
        select: { id: true, name: true },
      }),
      this.prisma.bundleRouteStep.findMany({
        where: { factoryId, id: { in: routeStepIds } },
        select: { id: true, processCodeSnapshot: true, processNameSnapshot: true },
      }),
    ]);
    const actorNames = new Map<string, string>([
      ...users.map((user): [string, string] => [user.id, user.displayName]),
      ...workers.map((worker): [string, string] => [worker.id, worker.name]),
    ]);
    const processSnapshots = new Map(routeSteps.map((step): [string, TimelineProcessSnapshot] => [step.id, {
      processCode: step.processCodeSnapshot,
      processName: step.processNameSnapshot,
    }]));
    return {
      items: items.map((event) => ({
        id: event.id,
        bundleId: event.bundleId,
        eventType: event.eventType,
        eventAt: event.eventAt.toISOString(),
        actorUserId: event.actorUserId,
        actorWorkerId: event.actorWorkerId,
        actorName: (event.actorWorkerId && actorNames.get(event.actorWorkerId))
          || (event.actorUserId && actorNames.get(event.actorUserId))
          || null,
        workReportId: event.workReportId,
        payload: enrichBundleEventPayload(event.payload, processSnapshots),
      })),
      page: { nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null, hasMore },
    };
  }

  async list(factoryId: string, query: BundleListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const search = query.q === undefined ? undefined : text(query.q, 'q', 100);
    const orderId = query.orderId === undefined ? undefined : uuid(query.orderId, 'orderId');
    const cuttingBedId = query.cuttingBedId === undefined ? undefined : uuid(query.cuttingBedId, 'cuttingBedId');
    const status = oneOf(query.bundleStatus, 'bundleStatus', BUNDLE_STATUSES);
    const processId = query.processId === undefined ? undefined : uuid(query.processId, 'processId');
    const workshopId = query.workshopId === undefined ? undefined : uuid(query.workshopId, 'workshopId');
    const lineId = query.lineId === undefined ? undefined : uuid(query.lineId, 'lineId');
    const stalledMinutes = query.stalledMinutesGte === undefined
      ? undefined
      : integer(typeof query.stalledMinutesGte === 'string' ? Number(query.stalledMinutesGte) : query.stalledMinutesGte, 'stalledMinutesGte');
    const where: Prisma.BundleWhereInput = {
      factoryId,
      ...(search ? { OR: [{ bundleNo: { contains: search, mode: 'insensitive' } }, { shortCode: { equals: search, mode: 'insensitive' } }] } : {}),
      ...(orderId ? { orderId } : {}),
      ...(cuttingBedId ? { cuttingBedId } : {}),
      ...(status ? { status } : {}),
      ...(processId ? { routeSteps: { some: { processId } } } : {}),
      ...(workshopId ? { currentWorkshopId: workshopId } : {}),
      ...(lineId ? { currentLineId: lineId } : {}),
      ...(stalledMinutes !== undefined ? { updatedAt: { lte: new Date(Date.now() - stalledMinutes * 60_000) } } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.bundle.findMany({
        where,
        include: bundleInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.bundle.count({ where }),
    ]);
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return {
      items: items.map(serializeBundle),
      page: { nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null, hasMore, total },
    };
  }
}


function serializeBundleWorkDetail(bundle: BundleWorkDetailRecord): Record<string, unknown> {
  const rows: Array<Record<string, unknown>> = [];
  for (const step of bundle.routeSteps) {
    if (step.workReports.length === 0) {
      rows.push({
        stepNo: step.stepNo,
        processCode: step.processCodeSnapshot,
        processName: step.processNameSnapshot,
        workerNo: null,
        workerName: null,
        status: step.status,
        startedAt: step.startedAt?.toISOString() ?? null,
        completedAt: step.completedAt?.toISOString() ?? null,
        inputQty: step.inputQty,
        goodQty: step.goodQty,
        defectQty: step.defectQty,
        missingQty: step.missingQty,
        unitRate: step.pieceRateSnapshot.toFixed(4),
        amount: '0.0000',
        notes: null,
      });
      continue;
    }
    for (const report of step.workReports) {
      rows.push({
        stepNo: step.stepNo,
        processCode: step.processCodeSnapshot,
        processName: step.processNameSnapshot,
        workerNo: report.worker.workerNo,
        workerName: report.worker.name,
        status: report.status,
        startedAt: report.startedAt.toISOString(),
        completedAt: report.completedAt?.toISOString() ?? null,
        inputQty: report.inputQty,
        goodQty: report.goodQty,
        defectQty: report.defectQty,
        missingQty: report.missingQty,
        unitRate: report.unitRateSnapshot.toFixed(4),
        amount: report.pieceworkEntries
          .reduce((total, entry) => total.add(entry.amount), new Prisma.Decimal(0))
          .toFixed(4),
        notes: report.notes,
      });
    }
  }
  return {
    bundle: {
      id: bundle.id,
      bundleNo: bundle.bundleNo,
      status: bundle.status,
      bedNo: bundle.cuttingBed.bedNo,
      orderNo: bundle.order.orderNo,
      styleCode: bundle.order.style.code,
      styleName: bundle.order.style.name,
      colorCode: bundle.orderItem.color.code,
      colorName: bundle.orderItem.color.name,
      sizeCode: bundle.orderItem.size.code,
      sizeName: bundle.orderItem.size.name,
      dyeLotNo: bundle.orderItem.dyeLotNo,
      effectiveQty: bundle.effectiveQty,
      completedQty: bundle.completedQty,
      routeVersionNo: bundle.routeVersion.versionNo,
    },
    rows,
  };
}

async function prepareGeneration(client: GenerationClient, factoryId: string, cuttingBedId: string, input: GenerationInput) {
  const [bed, route] = await Promise.all([
    client.cuttingBed.findFirst({ where: { id: cuttingBedId, factoryId }, include: generationBedInclude }),
    client.routeVersion.findFirst({ where: { id: input.routeVersionId, factoryId, status: 'PUBLISHED' }, include: generationRouteInclude }),
  ]);
  if (!bed) throw new NotFoundException('Cutting bed not found');
  if (!route || route.styleId !== bed.order.styleId || route.steps.length === 0) {
    throw new UnprocessableEntityException('A published route for the order style is required');
  }
  if (!['RELEASED', 'IN_PROGRESS'].includes(bed.order.status)) {
    throw new UnprocessableEntityException('The production order is not released');
  }
  if (bed.status === 'CANCELLED') {
    throw new ConflictException('Bundles cannot be generated for a cancelled cutting bed');
  }

  const items = new Map(bed.order.items.map((item) => [item.id, item]));
  const planLines: BundleLinePlanInput[] = input.lines.map((line) => {
    const item = items.get(line.orderItemId);
    if (!item) throw new UnprocessableEntityException('An orderItemId does not belong to the cutting bed order');
    const allocatedQty = item.bundles
      .filter((bundle) => bundle.status !== 'CANCELLED')
      .reduce((total, bundle) => total + bundle.effectiveQty, 0);
    return {
      ...line,
      plannedQty: item.plannedQty,
      allocatedQty,
      overproductionLimit: item.overproductionLimit,
    };
  });
  const startingSequence = Math.max(0, ...bed.bundles.map((bundle) => bundle.bundleSeq)) + 1;
  const plans = planBundles(planLines, startingSequence);
  const warnings = [
    ...(plans.some((plan) => plan.isTail) ? ['包含尾扎，请确认尾扎数量。'] : []),
    ...(input.lines.some((line) => line.authorizedOverproductionQty > 0) ? ['包含已授权超投数量。'] : []),
  ];
  return { bed, route, plans, warnings };
}

function normalizeGeneration(body: unknown): GenerationInput {
  const value = objectBody(body);
  if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 1_000) {
    throw new UnprocessableEntityException('lines must contain 1-1000 entries');
  }
  const lines = value.lines.map((raw, index) => {
    const line = objectBody(raw);
    if (line.allowTailBundle !== undefined && typeof line.allowTailBundle !== 'boolean') {
      throw new UnprocessableEntityException(`lines[${index}].allowTailBundle must be boolean`);
    }
    return {
      orderItemId: uuid(line.orderItemId, `lines[${index}].orderItemId`),
      standardBundleQty: integer(line.standardBundleQty, `lines[${index}].standardBundleQty`, 1),
      quantityToAllocate: line.quantityToAllocate === undefined || line.quantityToAllocate === null
        ? null
        : integer(line.quantityToAllocate, `lines[${index}].quantityToAllocate`, 1),
      allowTailBundle: line.allowTailBundle !== false,
      authorizedOverproductionQty: line.authorizedOverproductionQty === undefined
        ? 0
        : integer(line.authorizedOverproductionQty, `lines[${index}].authorizedOverproductionQty`),
      overproductionReason: optionalText(line.overproductionReason, `lines[${index}].overproductionReason`, 500),
    };
  });
  if (new Set(lines.map((line) => line.orderItemId)).size !== lines.length) {
    throw new UnprocessableEntityException('orderItemId may occur only once per generation request');
  }
  return {
    routeVersionId: uuid(value.routeVersionId, 'routeVersionId'),
    bundleNoPrefix: optionalText(value.bundleNoPrefix, 'bundleNoPrefix', 40),
    lines,
  };
}

function previewResponse(plans: ReturnType<typeof planBundles>, warnings: string[]): Record<string, unknown> {
  return {
    bundleCount: plans.length,
    totalQty: plans.reduce((total, plan) => total + plan.plannedQty, 0),
    items: plans,
    warnings,
  };
}
