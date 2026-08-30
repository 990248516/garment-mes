import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../production/idempotency.service';
import {
  calendarDate,
  decodeCursor,
  encodeCursor,
  integer,
  isoDate,
  objectBody,
  oneOf,
  optionalDate,
  optionalText,
  pageLimit,
  uuid,
} from '../production/validation';
import { ifMatchVersion } from './master-data.service';

const ROUTE_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
const MAX_ROUTE_STEPS = 500;
const MAX_ALLOWED_WORKSHOPS = 100;

export interface RouteVersionListQuery {
  styleId?: unknown;
  routeStatus?: unknown;
  cursor?: unknown;
  limit?: unknown;
}

export interface RouteStepInput {
  stepNo: number;
  processId: string;
  isRequired: boolean;
  isQualityGate: boolean;
  allowParallel: boolean;
  canSkip: boolean;
  isFinal: boolean;
  standardSeconds: number | null;
  pieceRate: Prisma.Decimal | null;
  allowedWorkshopIds: string[];
  minimumSkillLevel: number;
  prerequisiteStepNos: number[];
}

interface RouteCreateInput {
  styleId: string;
  effectiveFrom: Date | null;
  steps: RouteStepInput[];
}

const routeVersionInclude = Prisma.validator<Prisma.RouteVersionInclude>()({
  style: { select: { code: true } },
  steps: { orderBy: { stepNo: 'asc' }, include: { process: { select: { code: true, name: true } } } },
});
type RouteVersionRecord = Prisma.RouteVersionGetPayload<{ include: typeof routeVersionInclude }>;

@Injectable()
export class RouteVersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(factoryId: string, query: RouteVersionListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const styleId = query.styleId === undefined ? undefined : uuid(query.styleId, 'styleId');
    const status = oneOf(query.routeStatus, 'routeStatus', ROUTE_STATUSES);
    const where: Prisma.RouteVersionWhereInput = {
      factoryId,
      ...(styleId ? { styleId } : {}),
      ...(status ? { status } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.routeVersion.findMany({
        where,
        include: routeVersionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.routeVersion.count({ where }),
    ]);
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return {
      items: items.map(serializeRouteVersion),
      page: {
        nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null,
        hasMore,
        total,
      },
    };
  }

  async get(factoryId: string, routeVersionIdValue: unknown): Promise<Record<string, unknown>> {
    const routeVersionId = uuid(routeVersionIdValue, 'routeVersionId');
    const route = await this.prisma.routeVersion.findFirst({
      where: { id: routeVersionId, factoryId },
      include: routeVersionInclude,
    });
    if (!route) throw new NotFoundException('Route version not found');
    return serializeRouteVersion(route);
  }

  async create(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = normalizeRouteCreate(body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        'route-versions:create',
        body,
        201,
        async (transaction) => {
          await validateRouteReferences(transaction, factoryId, input.styleId, input.steps);
          const latest = await transaction.routeVersion.aggregate({
            where: { styleId: input.styleId },
            _max: { versionNo: true },
          });
          const route = await transaction.routeVersion.create({
            data: {
              factoryId,
              styleId: input.styleId,
              versionNo: (latest._max.versionNo ?? 0) + 1,
              effectiveFrom: input.effectiveFrom,
              createdBy: actorUserId,
              updatedBy: actorUserId,
              steps: { create: input.steps.map((step) => routeStepCreate(factoryId, step)) },
            },
            include: routeVersionInclude,
          });
          return serializeRouteVersion(route);
        },
      );
    } catch (error) {
      throw translateRouteConstraint(error);
    }
  }

  async replace(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    ifMatch: string | string[] | undefined,
    routeVersionIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const routeVersionId = uuid(routeVersionIdValue, 'routeVersionId');
    const expectedVersion = ifMatchVersion(ifMatch);
    const input = normalizeRouteReplace(body);
    return this.idempotency.execute(
      factoryId,
      requestId,
      `route-versions:${routeVersionId}:replace:v${expectedVersion}`,
      body,
      200,
      async (transaction) => {
        const route = await transaction.routeVersion.findFirst({
          where: { id: routeVersionId, factoryId },
          select: { id: true, styleId: true, status: true, version: true },
        });
        if (!route) throw new NotFoundException('Route version not found');
        if (route.status !== 'DRAFT') throw new ConflictException('Only draft route versions may be replaced');
        if (route.version !== expectedVersion) throw new ConflictException('Route version has changed');
        await validateRouteReferences(transaction, factoryId, route.styleId, input.steps);

        const claimed = await transaction.routeVersion.updateMany({
          where: { id: routeVersionId, factoryId, status: 'DRAFT', version: expectedVersion },
          data: {
            effectiveFrom: input.effectiveFrom,
            updatedBy: actorUserId,
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) throw new ConflictException('Route version has changed');
        await transaction.routeStep.deleteMany({ where: { routeVersionId } });
        await transaction.routeStep.createMany({
          data: input.steps.map((step) => ({ routeVersionId, ...routeStepCreate(factoryId, step) })),
        });
        const updated = await transaction.routeVersion.findUniqueOrThrow({
          where: { id: routeVersionId },
          include: routeVersionInclude,
        });
        return serializeRouteVersion(updated);
      },
    );
  }

  async publish(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    routeVersionIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const routeVersionId = uuid(routeVersionIdValue, 'routeVersionId');
    const input = normalizeRoutePublish(body);
    return this.idempotency.execute(
      factoryId,
      requestId,
      `route-versions:${routeVersionId}:publish`,
      body,
      200,
      async (transaction) => {
        const route = await transaction.routeVersion.findFirst({
          where: { id: routeVersionId, factoryId },
          include: routeVersionInclude,
        });
        if (!route) throw new NotFoundException('Route version not found');
        if (route.status !== 'DRAFT') throw new ConflictException('Only draft route versions may be published');
        validatePublishableSteps(route.steps);
        await validateRouteReferences(
          transaction,
          factoryId,
          route.styleId,
          route.steps.map((step) => ({
            stepNo: step.stepNo,
            processId: step.processId,
            isRequired: step.isRequired,
            isQualityGate: step.isQualityGate,
            allowParallel: step.allowParallel,
            canSkip: step.canSkip,
            isFinal: step.isFinal,
            standardSeconds: step.standardSeconds,
            pieceRate: step.pieceRate,
            allowedWorkshopIds: step.allowedWorkshopIds,
            minimumSkillLevel: step.minimumSkillLevel,
            prerequisiteStepNos: step.prerequisiteStepNos,
          })),
        );
        await transaction.routeVersion.updateMany({
          where: { factoryId, styleId: route.styleId, status: 'PUBLISHED', id: { not: routeVersionId } },
          data: { status: 'RETIRED', updatedBy: actorUserId, version: { increment: 1 } },
        });
        const published = await transaction.routeVersion.update({
          where: { id: routeVersionId },
          data: {
            status: 'PUBLISHED',
            effectiveFrom: input.effectiveFrom,
            publishedAt: new Date(),
            publishedBy: actorUserId,
            updatedBy: actorUserId,
            version: { increment: 1 },
          },
          include: routeVersionInclude,
        });
        return serializeRouteVersion(published);
      },
    );
  }

  async clone(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    routeVersionIdValue: unknown,
  ): Promise<Record<string, unknown>> {
    const routeVersionId = uuid(routeVersionIdValue, 'routeVersionId');
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        `route-versions:${routeVersionId}:clone`,
        {},
        201,
        async (transaction) => {
          const source = await transaction.routeVersion.findFirst({
            where: { id: routeVersionId, factoryId },
            include: routeVersionInclude,
          });
          if (!source) throw new NotFoundException('Route version not found');
          const latest = await transaction.routeVersion.aggregate({
            where: { styleId: source.styleId },
            _max: { versionNo: true },
          });
          const clone = await transaction.routeVersion.create({
            data: {
              factoryId,
              styleId: source.styleId,
              versionNo: (latest._max.versionNo ?? 0) + 1,
              status: 'DRAFT',
              effectiveFrom: null,
              createdBy: actorUserId,
              updatedBy: actorUserId,
              steps: {
                create: source.steps.map((step) => ({
                  factoryId,
                  stepNo: step.stepNo,
                  processId: step.processId,
                  isRequired: step.isRequired,
                  isQualityGate: step.isQualityGate,
                  allowParallel: step.allowParallel,
                  canSkip: step.canSkip,
                  isFinal: step.isFinal,
                  standardSeconds: step.standardSeconds,
                  pieceRate: step.pieceRate,
                  allowedWorkshopIds: step.allowedWorkshopIds,
                  minimumSkillLevel: step.minimumSkillLevel,
                  prerequisiteStepNos: step.prerequisiteStepNos,
                })),
              },
            },
            include: routeVersionInclude,
          });
          return serializeRouteVersion(clone);
        },
      );
    } catch (error) {
      throw translateRouteConstraint(error);
    }
  }
}

export function normalizeRouteCreate(body: unknown): RouteCreateInput {
  const value = objectBody(body);
  const steps = value.steps === undefined ? [] : normalizeRouteSteps(value.steps);
  return {
    styleId: uuid(value.styleId, 'styleId'),
    effectiveFrom: optionalDate(value.effectiveFrom, 'effectiveFrom'),
    steps,
  };
}

export function normalizeRouteReplace(body: unknown): Pick<RouteCreateInput, 'effectiveFrom' | 'steps'> {
  const value = objectBody(body);
  if (value.steps === undefined) throw new BadRequestException('steps is required');
  return {
    effectiveFrom: optionalDate(value.effectiveFrom, 'effectiveFrom'),
    steps: normalizeRouteSteps(value.steps),
  };
}

export function normalizeRouteSteps(value: unknown): RouteStepInput[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ROUTE_STEPS) {
    throw new BadRequestException(`steps must contain 1-${MAX_ROUTE_STEPS} items`);
  }
  const steps = value.map((raw, index) => {
    const item = objectBody(raw);
    const allowedWorkshopIds = uuidArray(item.allowedWorkshopIds, `steps[${index}].allowedWorkshopIds`, MAX_ALLOWED_WORKSHOPS);
    const prerequisiteStepNos = integerArray(item.prerequisiteStepNos, `steps[${index}].prerequisiteStepNos`);
    return {
      stepNo: integer(item.stepNo, `steps[${index}].stepNo`, 1, MAX_ROUTE_STEPS),
      processId: uuid(item.processId, `steps[${index}].processId`),
      isRequired: booleanValue(item.isRequired, `steps[${index}].isRequired`),
      isQualityGate: booleanValue(item.isQualityGate, `steps[${index}].isQualityGate`),
      allowParallel: booleanValue(item.allowParallel, `steps[${index}].allowParallel`),
      canSkip: optionalBoolean(item.canSkip, `steps[${index}].canSkip`, false),
      isFinal: optionalBoolean(item.isFinal, `steps[${index}].isFinal`, false),
      standardSeconds: item.standardSeconds === undefined || item.standardSeconds === null
        ? null
        : integer(item.standardSeconds, `steps[${index}].standardSeconds`),
      pieceRate: optionalMoney(item.pieceRate, `steps[${index}].pieceRate`),
      allowedWorkshopIds,
      minimumSkillLevel: item.minimumSkillLevel === undefined
        ? 1
        : integer(item.minimumSkillLevel, `steps[${index}].minimumSkillLevel`, 1, 5),
      prerequisiteStepNos,
    };
  }).sort((left, right) => left.stepNo - right.stepNo);

  if (new Set(steps.map((step) => step.stepNo)).size !== steps.length) {
    throw new UnprocessableEntityException('Route stepNo values must be unique');
  }
  if (steps.some((step, index) => step.stepNo !== index + 1)) {
    throw new UnprocessableEntityException('Route stepNo values must be contiguous starting at 1');
  }
  for (const step of steps) {
    if (step.prerequisiteStepNos.some((prerequisite) => prerequisite >= step.stepNo)) {
      throw new UnprocessableEntityException(`Step ${step.stepNo} prerequisites must refer to earlier steps`);
    }
  }
  return steps;
}

export function validatePublishableSteps(steps: Array<{ isFinal: boolean }>): void {
  if (steps.length < 1) throw new UnprocessableEntityException('A route must contain at least one step before publishing');
  if (steps.filter((step) => step.isFinal).length !== 1) {
    throw new UnprocessableEntityException('A published route must contain exactly one final step');
  }
}

function normalizeRoutePublish(body: unknown): { effectiveFrom: Date; reason: string | null } {
  const value = objectBody(body);
  if (value.effectiveFrom === undefined || value.effectiveFrom === null || value.effectiveFrom === '') {
    throw new BadRequestException('effectiveFrom is required');
  }
  return {
    effectiveFrom: calendarDate(value.effectiveFrom, 'effectiveFrom'),
    reason: optionalText(value.reason, 'reason', 500),
  };
}

function routeStepCreate(factoryId: string, step: RouteStepInput) {
  return {
    factoryId,
    stepNo: step.stepNo,
    processId: step.processId,
    isRequired: step.isRequired,
    isQualityGate: step.isQualityGate,
    allowParallel: step.allowParallel,
    canSkip: step.canSkip,
    isFinal: step.isFinal,
    standardSeconds: step.standardSeconds,
    pieceRate: step.pieceRate,
    allowedWorkshopIds: step.allowedWorkshopIds,
    minimumSkillLevel: step.minimumSkillLevel,
    prerequisiteStepNos: step.prerequisiteStepNos,
  };
}

async function validateRouteReferences(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  styleId: string,
  steps: RouteStepInput[],
): Promise<void> {
  const processIds = [...new Set(steps.map((step) => step.processId))];
  const workshopIds = [...new Set(steps.flatMap((step) => step.allowedWorkshopIds))];
  const [style, processCount, workshopRows] = await Promise.all([
    transaction.style.findFirst({
      where: { id: styleId, factoryId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    }),
    transaction.process.count({
      where: { id: { in: processIds }, factoryId, status: 'ACTIVE' },
    }),
    workshopIds.length === 0
      ? Promise.resolve([] as Array<{ id: string }>)
      : transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id::text AS id
          FROM workshops
          WHERE factory_id = ${factoryId}::uuid
            AND id::text IN (${Prisma.join(workshopIds)})
        `),
  ]);
  if (!style) throw new UnprocessableEntityException('styleId is not active in this factory');
  if (processCount !== processIds.length) {
    throw new UnprocessableEntityException('One or more processId values are not active in this factory');
  }
  if (workshopRows.length !== workshopIds.length) {
    throw new UnprocessableEntityException('One or more allowedWorkshopIds do not belong to this factory');
  }
}

function serializeRouteVersion(route: RouteVersionRecord): Record<string, unknown> {
  return {
    id: route.id,
    factoryId: route.factoryId,
    styleId: route.styleId,
    styleCode: route.style.code,
    versionNo: route.versionNo,
    status: route.status,
    effectiveFrom: isoDate(route.effectiveFrom),
    publishedAt: route.publishedAt?.toISOString() ?? null,
    publishedBy: route.publishedBy,
    steps: route.steps.map((step) => ({
      id: step.id,
      stepNo: step.stepNo,
      processId: step.processId,
      processCode: step.process.code,
      processName: step.process.name,
      isRequired: step.isRequired,
      isQualityGate: step.isQualityGate,
      allowParallel: step.allowParallel,
      canSkip: step.canSkip,
      isFinal: step.isFinal,
      standardSeconds: step.standardSeconds,
      pieceRate: step.pieceRate?.toFixed(4) ?? null,
      allowedWorkshopIds: step.allowedWorkshopIds,
      minimumSkillLevel: step.minimumSkillLevel,
      prerequisiteStepNos: step.prerequisiteStepNos,
    })),
    createdAt: route.createdAt.toISOString(),
    updatedAt: route.updatedAt.toISOString(),
    createdBy: route.createdBy,
    updatedBy: route.updatedBy,
    version: route.version,
  };
}

function booleanValue(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${name} must be a boolean`);
  return value;
}

function optionalBoolean(value: unknown, name: string, defaultValue: boolean): boolean {
  return value === undefined ? defaultValue : booleanValue(value, name);
}

function uuidArray(value: unknown, name: string, maximum: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum) {
    throw new BadRequestException(`${name} must be an array with at most ${maximum} items`);
  }
  const items = value.map((item, index) => uuid(item, `${name}[${index}]`));
  if (new Set(items).size !== items.length) throw new BadRequestException(`${name} must not contain duplicates`);
  return items;
}

function integerArray(value: unknown, name: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ROUTE_STEPS) {
    throw new BadRequestException(`${name} must be an array with at most ${MAX_ROUTE_STEPS} items`);
  }
  const items = value.map((item, index) => integer(item, `${name}[${index}]`, 1, MAX_ROUTE_STEPS));
  if (new Set(items).size !== items.length) throw new BadRequestException(`${name} must not contain duplicates`);
  return items.sort((left, right) => left - right);
}

function optionalMoney(value: unknown, name: string): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,4})?$/.test(String(value))) {
    throw new BadRequestException(`${name} must be a non-negative amount with at most 4 decimal places`);
  }
  const amount = new Prisma.Decimal(value);
  if (amount.gt('9999999999.9999')) throw new BadRequestException(`${name} is too large`);
  return amount;
}

function translateRouteConstraint(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException('Route version number already exists');
    if (error.code === 'P2003') return new UnprocessableEntityException('Referenced route data is invalid');
  }
  return error;
}
