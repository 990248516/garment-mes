import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { hashSecret } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../production/idempotency.service';
import {
  decodeCursor,
  encodeCursor,
  isoDate,
  objectBody,
  oneOf,
  optionalDate,
  optionalUuid,
  pageLimit,
  text,
  uuid,
} from '../production/validation';
import { ifMatchVersion } from './master-data.service';
import {
  normalizeSkillReplacement,
  serializeWorkerSkill,
  type SkillInput,
} from './worker-skills.service';

const WORKER_STATUSES = ['ACTIVE', 'INACTIVE', 'LEFT'] as const;
type WorkerStatus = typeof WORKER_STATUSES[number];

export interface WorkerListQuery {
  cursor?: unknown;
  limit?: unknown;
  q?: unknown;
  status?: unknown;
  workshopId?: unknown;
  productionLineId?: unknown;
  processId?: unknown;
}

export interface WorkerCreateInput {
  workerNo: string;
  name: string;
  userId: string | null;
  pin: string | null;
  workshopId: string | null;
  productionLineId: string | null;
  hiredOn: Date | null;
  status: WorkerStatus;
  skills: SkillInput[];
}

export interface WorkerPatchInput {
  name?: string;
  userId?: string | null;
  pin?: string | null;
  workshopId?: string | null;
  productionLineId?: string | null;
  status?: WorkerStatus;
  leftOn?: Date | null;
}

const workerInclude = Prisma.validator<Prisma.WorkerInclude>()({
  skills: {
    include: { process: true },
    orderBy: [{ process: { name: 'asc' } }, { effectiveFrom: 'desc' }],
  },
});
type WorkerRecord = Prisma.WorkerGetPayload<{ include: typeof workerInclude }>;
type WorkerClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(factoryId: string, query: WorkerListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const search = query.q === undefined ? undefined : text(query.q, 'q', 100);
    const status = oneOf(query.status, 'status', ['ACTIVE', 'INACTIVE'] as const);
    const workshopId = query.workshopId === undefined ? undefined : uuid(query.workshopId, 'workshopId');
    const productionLineId = query.productionLineId === undefined
      ? undefined
      : uuid(query.productionLineId, 'productionLineId');
    const processId = query.processId === undefined ? undefined : uuid(query.processId, 'processId');
    const where: Prisma.WorkerWhereInput = {
      factoryId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(workshopId ? { workshopId } : {}),
      ...(productionLineId ? { productionLineId } : {}),
      ...(processId ? { skills: { some: { processId } } } : {}),
      ...(search ? {
        OR: [
          { workerNo: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.worker.findMany({
        where,
        include: workerInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.worker.count({ where }),
    ]);
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return {
      items: items.map(serializeWorker),
      page: {
        nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null,
        hasMore,
        total,
      },
    };
  }

  async get(factoryId: string, workerIdValue: unknown): Promise<Record<string, unknown>> {
    const workerId = uuid(workerIdValue, 'workerId');
    const worker = await this.prisma.worker.findFirst({
      where: { id: workerId, factoryId, deletedAt: null },
      include: workerInclude,
    });
    if (!worker) throw new NotFoundException('Worker not found');
    return serializeWorker(worker);
  }

  async create(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = normalizeWorkerCreate(body);
    const pinHash = input.pin ? await hashSecret(input.pin) : null;
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        'workers:create',
        body,
        201,
        async (transaction) => {
          const [placement] = await Promise.all([
            resolvePlacement(transaction, factoryId, input.workshopId, input.productionLineId),
            validateUserAssociation(transaction, factoryId, input.userId),
            validateSkillProcesses(transaction, factoryId, input.skills),
          ]);
          const worker = await transaction.worker.create({
            data: {
              factoryId,
              userId: input.userId,
              workerNo: input.workerNo,
              name: input.name,
              pinHash,
              workshopId: placement.workshopId,
              productionLineId: placement.productionLineId,
              hiredOn: input.hiredOn,
              status: input.status,
              createdBy: actorUserId,
              updatedBy: actorUserId,
              skills: {
                create: input.skills.map((skill) => ({
                  processId: skill.processId,
                  skillLevel: skill.level,
                  effectiveFrom: skill.effectiveFrom,
                  effectiveTo: skill.effectiveTo,
                })),
              },
            },
            include: workerInclude,
          });
          return serializeWorker(worker);
        },
      );
    } catch (error) {
      throw translateWorkerConstraint(error);
    }
  }

  async update(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    ifMatchValue: string | string[] | undefined,
    workerIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const workerId = uuid(workerIdValue, 'workerId');
    const expectedVersion = ifMatchVersion(ifMatchValue);
    const input = normalizeWorkerPatch(body);
    const pinHash = typeof input.pin === 'string' ? await hashSecret(input.pin) : input.pin;
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        `workers:${workerId}:update:v${expectedVersion}`,
        { body, expectedVersion },
        200,
        async (transaction) => {
          const existing = await transaction.worker.findFirst({
            where: { id: workerId, factoryId, deletedAt: null },
          });
          if (!existing) throw new NotFoundException('Worker not found');
          if (existing.version !== expectedVersion) {
            throw new ConflictException(`Version mismatch; current version is ${existing.version}`);
          }

          if (input.userId !== undefined) {
            await validateUserAssociation(transaction, factoryId, input.userId, workerId);
          }
          const placement = await resolveUpdatedPlacement(transaction, factoryId, existing, input);
          const nextLeftOn = input.leftOn === undefined ? existing.leftOn : input.leftOn;
          if (existing.hiredOn && nextLeftOn && nextLeftOn < existing.hiredOn) {
            throw new UnprocessableEntityException('leftOn must not precede hiredOn');
          }

          const data: Prisma.WorkerUncheckedUpdateManyInput = {
            updatedBy: actorUserId,
            version: { increment: 1 },
          };
          if (input.name !== undefined) data.name = input.name;
          if (input.userId !== undefined) data.userId = input.userId;
          if (input.pin !== undefined) data.pinHash = input.pin === null ? null : pinHash!;
          if (input.status !== undefined) data.status = input.status;
          if (input.leftOn !== undefined) data.leftOn = input.leftOn;
          if (placement.changed) {
            data.workshopId = placement.workshopId;
            data.productionLineId = placement.productionLineId;
          }

          const updated = await transaction.worker.updateMany({
            where: { id: workerId, factoryId, version: expectedVersion, deletedAt: null },
            data,
          });
          if (updated.count !== 1) throw new ConflictException('Worker was updated concurrently');
          const worker = await transaction.worker.findUniqueOrThrow({
            where: { id: workerId },
            include: workerInclude,
          });
          return serializeWorker(worker);
        },
      );
    } catch (error) {
      throw translateWorkerConstraint(error);
    }
  }
}

export function normalizeWorkerCreate(body: unknown, today = new Date()): WorkerCreateInput {
  const value = objectBody(body);
  return {
    workerNo: text(value.workerNo, 'workerNo', 40),
    name: text(value.name, 'name', 80),
    userId: optionalUuid(value.userId, 'userId'),
    pin: value.pin === undefined || value.pin === null ? null : workerPin(value.pin),
    workshopId: optionalUuid(value.workshopId, 'workshopId'),
    productionLineId: optionalUuid(value.productionLineId, 'productionLineId'),
    hiredOn: optionalDate(value.hiredOn, 'hiredOn'),
    status: oneOf(value.status, 'status', WORKER_STATUSES) ?? 'ACTIVE',
    skills: value.skills === undefined
      ? []
      : normalizeSkillReplacement({ skills: value.skills }, today),
  };
}

export function normalizeWorkerPatch(body: unknown): WorkerPatchInput {
  const value = objectBody(body);
  const input: WorkerPatchInput = {};
  if (value.name !== undefined) input.name = text(value.name, 'name', 80);
  if (value.userId !== undefined) input.userId = optionalUuid(value.userId, 'userId');
  if (value.pin !== undefined) input.pin = value.pin === null ? null : workerPin(value.pin);
  if (value.workshopId !== undefined) input.workshopId = optionalUuid(value.workshopId, 'workshopId');
  if (value.productionLineId !== undefined) {
    input.productionLineId = optionalUuid(value.productionLineId, 'productionLineId');
  }
  if (value.status !== undefined) {
    const status = oneOf(value.status, 'status', WORKER_STATUSES);
    if (!status) throw new BadRequestException(`status must be one of: ${WORKER_STATUSES.join(', ')}`);
    input.status = status;
  }
  if (value.leftOn !== undefined) input.leftOn = optionalDate(value.leftOn, 'leftOn');
  if (Object.keys(input).length === 0) {
    throw new BadRequestException('Request body must contain at least one worker field');
  }
  return input;
}

async function resolveUpdatedPlacement(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  existing: { workshopId: string | null; productionLineId: string | null },
  input: WorkerPatchInput,
): Promise<{ workshopId: string | null; productionLineId: string | null; changed: boolean }> {
  const changed = input.workshopId !== undefined || input.productionLineId !== undefined;
  if (!changed) {
    return { workshopId: existing.workshopId, productionLineId: existing.productionLineId, changed: false };
  }
  if (input.workshopId === null && input.productionLineId === undefined && existing.productionLineId) {
    throw new UnprocessableEntityException('productionLineId must be cleared when workshopId is cleared');
  }
  const productionLineId = input.productionLineId === undefined
    ? existing.productionLineId
    : input.productionLineId;
  let workshopId = input.workshopId === undefined ? existing.workshopId : input.workshopId;
  if (input.productionLineId !== undefined && input.productionLineId !== null && input.workshopId === undefined) {
    workshopId = null;
  }
  return { ...(await resolvePlacement(transaction, factoryId, workshopId, productionLineId)), changed: true };
}

async function resolvePlacement(
  client: WorkerClient,
  factoryId: string,
  workshopId: string | null,
  productionLineId: string | null,
): Promise<{ workshopId: string | null; productionLineId: string | null }> {
  if (productionLineId) {
    const rows = await client.$queryRaw<Array<{ id: string; workshopId: string }>>(Prisma.sql`
      SELECT pl.id::text AS id, pl.workshop_id::text AS "workshopId"
      FROM production_lines pl
      JOIN workshops w ON w.id = pl.workshop_id
      WHERE pl.id = ${productionLineId}::uuid
        AND pl.factory_id = ${factoryId}::uuid
        AND pl.status = 'ACTIVE'
        AND w.factory_id = ${factoryId}::uuid
        AND w.status = 'ACTIVE'
    `);
    const line = rows[0];
    if (!line) throw new UnprocessableEntityException('productionLineId is not active in this factory');
    if (workshopId && workshopId !== line.workshopId) {
      throw new UnprocessableEntityException('productionLineId does not belong to workshopId');
    }
    return { workshopId: workshopId ?? line.workshopId, productionLineId };
  }
  if (workshopId) {
    const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id::text AS id
      FROM workshops
      WHERE id = ${workshopId}::uuid
        AND factory_id = ${factoryId}::uuid
        AND status = 'ACTIVE'
    `);
    if (rows.length !== 1) throw new UnprocessableEntityException('workshopId is not active in this factory');
  }
  return { workshopId, productionLineId: null };
}

async function validateUserAssociation(
  client: WorkerClient,
  factoryId: string,
  userId: string | null,
  currentWorkerId?: string,
): Promise<void> {
  if (!userId) return;
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT u.id::text AS id
    FROM app_users u
    JOIN factories f ON f.organization_id = u.organization_id
    WHERE u.id = ${userId}::uuid
      AND f.id = ${factoryId}::uuid
      AND u.deleted_at IS NULL
  `);
  if (rows.length !== 1) {
    throw new UnprocessableEntityException('userId does not belong to the factory organization');
  }
  const linked = await client.worker.findFirst({
    where: {
      userId,
      ...(currentWorkerId ? { id: { not: currentWorkerId } } : {}),
    },
    select: { id: true },
  });
  if (linked) throw new ConflictException('userId is already linked to another worker');
}

async function validateSkillProcesses(
  client: Prisma.TransactionClient,
  factoryId: string,
  skills: SkillInput[],
): Promise<void> {
  const processIds = [...new Set(skills.map((skill) => skill.processId))];
  if (processIds.length === 0) return;
  const count = await client.process.count({
    where: { id: { in: processIds }, factoryId, status: 'ACTIVE' },
  });
  if (count !== processIds.length) {
    throw new UnprocessableEntityException('One or more skill processId values are not active in this factory');
  }
}

function serializeWorker(worker: WorkerRecord): Record<string, unknown> {
  return {
    id: worker.id,
    factoryId: worker.factoryId,
    userId: worker.userId,
    workerNo: worker.workerNo,
    name: worker.name,
    workshopId: worker.workshopId,
    productionLineId: worker.productionLineId,
    status: worker.status,
    hiredOn: isoDate(worker.hiredOn),
    leftOn: isoDate(worker.leftOn),
    skills: worker.skills.map(serializeWorkerSkill),
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString(),
    createdBy: worker.createdBy,
    updatedBy: worker.updatedBy,
    version: worker.version,
  };
}

function workerPin(value: unknown): string {
  if (typeof value !== 'string' || value.length < 4 || value.length > 20) {
    throw new BadRequestException('pin must contain 4-20 characters or be null');
  }
  return value;
}

function translateWorkerConstraint(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new ConflictException('Worker number or account association already exists');
    }
    if (error.code === 'P2003') {
      return new UnprocessableEntityException('Referenced worker data is invalid');
    }
  }
  return error;
}
