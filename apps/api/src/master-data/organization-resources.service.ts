import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type ProductionLine, type Workshop } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../production/idempotency.service';
import {
  decodeCursor,
  encodeCursor,
  objectBody,
  oneOf,
  optionalUuid,
  pageLimit,
  text,
  uuid,
} from '../production/validation';

export interface OrganizationResourceListQuery {
  cursor?: unknown;
  limit?: unknown;
  q?: unknown;
  status?: unknown;
  workshopId?: unknown;
}

export interface WorkshopCreateInput {
  code: string;
  name: string;
  managerWorkerId: string | null;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ProductionLineCreateInput extends WorkshopCreateInput {
  workshopId: string;
}

@Injectable()
export class OrganizationResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async listWorkshops(factoryId: string, query: OrganizationResourceListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const search = query.q === undefined ? undefined : text(query.q, 'q', 100);
    const status = oneOf(query.status, 'status', ['ACTIVE', 'INACTIVE'] as const);
    const where: Prisma.WorkshopWhereInput = {
      factoryId,
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { code: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.workshop.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.workshop.count({ where }),
    ]);
    return page(records, limit, total, serializeWorkshop);
  }

  async createWorkshop(
    factoryId: string,
    requestId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = normalizeWorkshopCreate(body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        'workshops:create',
        body,
        201,
        async (transaction) => {
          await validateManager(transaction, factoryId, input.managerWorkerId);
          const workshop = await transaction.workshop.create({ data: { factoryId, ...input } });
          return serializeWorkshop(workshop);
        },
      );
    } catch (error) {
      throw translateOrganizationConstraint(error, 'Workshop code already exists in this factory');
    }
  }

  async listProductionLines(factoryId: string, query: OrganizationResourceListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const search = query.q === undefined ? undefined : text(query.q, 'q', 100);
    const status = oneOf(query.status, 'status', ['ACTIVE', 'INACTIVE'] as const);
    const workshopId = query.workshopId === undefined ? undefined : uuid(query.workshopId, 'workshopId');
    const where: Prisma.ProductionLineWhereInput = {
      factoryId,
      ...(workshopId ? { workshopId } : {}),
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { code: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.productionLine.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.productionLine.count({ where }),
    ]);
    return page(records, limit, total, serializeProductionLine);
  }

  async createProductionLine(
    factoryId: string,
    requestId: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const input = normalizeProductionLineCreate(body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        'production-lines:create',
        body,
        201,
        async (transaction) => {
          const [workshop] = await Promise.all([
            transaction.workshop.findFirst({
              where: { id: input.workshopId, factoryId, status: 'ACTIVE' },
              select: { id: true },
            }),
            validateManager(transaction, factoryId, input.managerWorkerId),
          ]);
          if (!workshop) throw new UnprocessableEntityException('workshopId is not active in this factory');
          const line = await transaction.productionLine.create({ data: { factoryId, ...input } });
          return serializeProductionLine(line);
        },
      );
    } catch (error) {
      throw translateOrganizationConstraint(error, 'Production line code already exists in this workshop');
    }
  }
}

export function normalizeWorkshopCreate(body: unknown): WorkshopCreateInput {
  const value = objectBody(body);
  return {
    code: text(value.code, 'code', 40),
    name: text(value.name, 'name', 120),
    managerWorkerId: optionalUuid(value.managerWorkerId, 'managerWorkerId'),
    status: oneOf(value.status, 'status', ['ACTIVE', 'INACTIVE'] as const) ?? 'ACTIVE',
  };
}

export function normalizeProductionLineCreate(body: unknown): ProductionLineCreateInput {
  const value = objectBody(body);
  return {
    ...normalizeWorkshopCreate(value),
    workshopId: uuid(value.workshopId, 'workshopId'),
  };
}

async function validateManager(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  managerWorkerId: string | null,
): Promise<void> {
  if (!managerWorkerId) return;
  const manager = await transaction.worker.findFirst({
    where: { id: managerWorkerId, factoryId, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (!manager) throw new UnprocessableEntityException('managerWorkerId is not active in this factory');
}

function serializeWorkshop(workshop: Workshop): Record<string, unknown> {
  return {
    id: workshop.id,
    factoryId: workshop.factoryId,
    code: workshop.code,
    name: workshop.name,
    managerWorkerId: workshop.managerWorkerId,
    status: workshop.status,
    createdAt: workshop.createdAt.toISOString(),
    updatedAt: workshop.updatedAt.toISOString(),
    version: workshop.version,
  };
}

function serializeProductionLine(line: ProductionLine): Record<string, unknown> {
  return {
    id: line.id,
    factoryId: line.factoryId,
    workshopId: line.workshopId,
    code: line.code,
    name: line.name,
    managerWorkerId: line.managerWorkerId,
    status: line.status,
    createdAt: line.createdAt.toISOString(),
    updatedAt: line.updatedAt.toISOString(),
    version: line.version,
  };
}

function page<T extends { id: string }>(
  records: T[],
  limit: number,
  total: number,
  serialize: (record: T) => Record<string, unknown>,
): Record<string, unknown> {
  const hasMore = records.length > limit;
  const items = records.slice(0, limit);
  return {
    items: items.map(serialize),
    page: {
      nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null,
      hasMore,
      total,
    },
  };
}

function translateOrganizationConstraint(error: unknown, message: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException(message);
    if (error.code === 'P2003') return new UnprocessableEntityException('Referenced organization data is invalid');
  }
  if (error instanceof BadRequestException || error instanceof UnprocessableEntityException) return error;
  return error;
}
