import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type Color,
  type Customer,
  Prisma,
  type Process,
  type Size,
  type Style,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../production/idempotency.service';
import {
  decodeCursor,
  encodeCursor,
  integer,
  objectBody,
  oneOf,
  optionalInteger,
  optionalText,
  optionalUuid,
  pageLimit,
  text,
  uuid,
} from '../production/validation';

export const MASTER_RESOURCES = ['customers', 'styles', 'colors', 'sizes', 'processes'] as const;
export type MasterResource = typeof MASTER_RESOURCES[number];
type MasterRecord = Customer | Style | Color | Size | Process;

export interface MasterListQuery {
  cursor?: unknown;
  limit?: unknown;
  q?: unknown;
  status?: unknown;
}

interface MasterInput {
  code: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  customerId: string | null;
  customerStyleNo: string | null;
  imageUrl: string | null;
  versionName: string | null;
  displayOrder: number;
  unit: string | null;
  defaultStandardSeconds: number | null;
  defaultPieceRate: Prisma.Decimal | null;
}

@Injectable()
export class MasterDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(factoryId: string, resourceValue: unknown, query: MasterListQuery): Promise<Record<string, unknown>> {
    const resource = masterResource(resourceValue);
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const search = query.q === undefined ? undefined : text(query.q, 'q', 100);
    const status = oneOf(query.status, 'status', ['ACTIVE', 'INACTIVE'] as const);
    const common = {
      factoryId,
      ...(status ? { status } : {}),
      ...(search ? {
        OR: [
          { code: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      } : {}),
    };
    const paging = {
      orderBy: [{ createdAt: Prisma.SortOrder.desc }, { id: Prisma.SortOrder.desc }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    };

    let records: MasterRecord[];
    let total: number;
    switch (resource) {
      case 'customers':
        [records, total] = await Promise.all([
          this.prisma.customer.findMany({ where: { ...common, deletedAt: null }, ...paging }),
          this.prisma.customer.count({ where: { ...common, deletedAt: null } }),
        ]);
        break;
      case 'styles':
        [records, total] = await Promise.all([
          this.prisma.style.findMany({ where: { ...common, deletedAt: null }, ...paging }),
          this.prisma.style.count({ where: { ...common, deletedAt: null } }),
        ]);
        break;
      case 'colors':
        [records, total] = await Promise.all([
          this.prisma.color.findMany({ where: common, ...paging }),
          this.prisma.color.count({ where: common }),
        ]);
        break;
      case 'sizes':
        [records, total] = await Promise.all([
          this.prisma.size.findMany({ where: common, ...paging }),
          this.prisma.size.count({ where: common }),
        ]);
        break;
      case 'processes':
        [records, total] = await Promise.all([
          this.prisma.process.findMany({ where: common, ...paging }),
          this.prisma.process.count({ where: common }),
        ]);
        break;
    }

    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return {
      items: items.map((record) => serializeMaster(resource, record)),
      page: {
        nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null,
        hasMore,
        total,
      },
    };
  }

  async get(factoryId: string, resourceValue: unknown, resourceIdValue: unknown): Promise<Record<string, unknown>> {
    const resource = masterResource(resourceValue);
    const resourceId = uuid(resourceIdValue, 'resourceId');
    const record = await this.findOne(this.prisma, factoryId, resource, resourceId);
    if (!record) throw new NotFoundException('Master data item not found');
    return serializeMaster(resource, record);
  }

  async create(
    factoryId: string,
    requestId: string,
    resourceValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const resource = masterResource(resourceValue);
    const input = normalizeMasterCreate(resource, body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        `master-data:${resource}:create`,
        body,
        201,
        async (transaction) => {
          await this.validateCustomer(transaction, factoryId, resource, input.customerId);
          const record = await createRecord(transaction, factoryId, resource, input);
          return serializeMaster(resource, record);
        },
      );
    } catch (error) {
      throw translateConstraint(error, 'Master data code already exists in this factory');
    }
  }

  async update(
    factoryId: string,
    requestId: string,
    ifMatchValue: string | string[] | undefined,
    resourceValue: unknown,
    resourceIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const resource = masterResource(resourceValue);
    const resourceId = uuid(resourceIdValue, 'resourceId');
    const expectedVersion = ifMatchVersion(ifMatchValue);
    const data = normalizeMasterPatch(resource, body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        `master-data:${resource}:${resourceId}:update:v${expectedVersion}`,
        { body, expectedVersion },
        200,
        async (transaction) => {
          const existing = await this.findOne(transaction, factoryId, resource, resourceId);
          if (!existing) throw new NotFoundException('Master data item not found');
          if (existing.version !== expectedVersion) {
            throw new ConflictException(`Version mismatch; current version is ${existing.version}`);
          }
          const customerId = 'customerId' in data && typeof data.customerId === 'string'
            ? data.customerId
            : null;
          if ('customerId' in data) await this.validateCustomer(transaction, factoryId, resource, customerId);
          const updated = await updateRecord(transaction, factoryId, resource, resourceId, expectedVersion, data);
          if (!updated) throw new ConflictException('Master data item was updated concurrently');
          if (resource === 'processes' && 'defaultPieceRate' in data) {
            const previousRate = (existing as Process).defaultPieceRate;
            const nextRate = data.defaultPieceRate as Prisma.Decimal;
            await transaction.routeStep.updateMany({
              where: {
                factoryId,
                processId: resourceId,
                OR: [{ pieceRate: null }, { pieceRate: previousRate }],
              },
              data: { pieceRate: nextRate },
            });
          }
          return serializeMaster(resource, updated);
        },
      );
    } catch (error) {
      throw translateConstraint(error, 'Master data value conflicts with an existing record');
    }
  }

  private async findOne(
    client: PrismaService | Prisma.TransactionClient,
    factoryId: string,
    resource: MasterResource,
    resourceId: string,
  ): Promise<MasterRecord | null> {
    switch (resource) {
      case 'customers': return client.customer.findFirst({ where: { id: resourceId, factoryId, deletedAt: null } });
      case 'styles': return client.style.findFirst({ where: { id: resourceId, factoryId, deletedAt: null } });
      case 'colors': return client.color.findFirst({ where: { id: resourceId, factoryId } });
      case 'sizes': return client.size.findFirst({ where: { id: resourceId, factoryId } });
      case 'processes': return client.process.findFirst({ where: { id: resourceId, factoryId } });
    }
  }

  private async validateCustomer(
    client: Prisma.TransactionClient,
    factoryId: string,
    resource: MasterResource,
    customerId: string | null,
  ): Promise<void> {
    if (resource !== 'styles' || !customerId) return;
    const customer = await client.customer.findFirst({
      where: { id: customerId, factoryId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new UnprocessableEntityException('customerId is not active in this factory');
  }
}

export function masterResource(value: unknown): MasterResource {
  if (typeof value !== 'string' || !MASTER_RESOURCES.includes(value as MasterResource)) {
    throw new BadRequestException(`resource must be one of: ${MASTER_RESOURCES.join(', ')}`);
  }
  return value as MasterResource;
}

export function ifMatchVersion(value: string | string[] | undefined): number {
  if (Array.isArray(value)) throw new BadRequestException('If-Match must occur once');
  const match = value?.match(/^"([1-9][0-9]*)"$/);
  if (!match) throw new BadRequestException('If-Match must be a quoted positive integer, for example "1"');
  return integer(Number(match[1]), 'If-Match', 1);
}

export function normalizeMasterCreate(resource: MasterResource, body: unknown): MasterInput {
  const value = objectBody(body);
  return {
    code: text(value.code, 'code', resource === 'styles' ? 60 : 40),
    name: text(value.name, 'name', 120),
    status: oneOf(value.status, 'status', ['ACTIVE', 'INACTIVE'] as const) ?? 'ACTIVE',
    customerId: optionalUuid(value.customerId, 'customerId'),
    customerStyleNo: optionalText(value.customerStyleNo, 'customerStyleNo', 100),
    imageUrl: optionalUri(value.imageUrl, 'imageUrl'),
    versionName: optionalText(value.versionName, 'versionName', 40),
    displayOrder: value.displayOrder === undefined ? 0 : integer(value.displayOrder, 'displayOrder'),
    unit: optionalText(value.unit, 'unit', 30),
    defaultStandardSeconds: optionalInteger(value.defaultStandardSeconds, 'defaultStandardSeconds'),
    defaultPieceRate: optionalMoney(value.defaultPieceRate, 'defaultPieceRate'),
  };
}

function normalizeMasterPatch(resource: MasterResource, body: unknown): Record<string, unknown> {
  const value = objectBody(body);
  const data: Record<string, unknown> = {};
  if (value.name !== undefined) data.name = text(value.name, 'name', 120);
  if (value.status !== undefined) {
    const status = oneOf(value.status, 'status', ['ACTIVE', 'INACTIVE'] as const);
    if (!status) throw new BadRequestException('status must be ACTIVE or INACTIVE');
    data.status = status;
  }
  if (resource === 'styles') {
    if (value.customerId !== undefined) data.customerId = optionalUuid(value.customerId, 'customerId');
    if (value.customerStyleNo !== undefined) data.customerStyleNo = optionalText(value.customerStyleNo, 'customerStyleNo', 100);
    if (value.imageUrl !== undefined) data.imageUrl = optionalUri(value.imageUrl, 'imageUrl');
    if (value.versionName !== undefined) data.versionName = optionalText(value.versionName, 'versionName', 40);
  }
  if (resource === 'colors' || resource === 'sizes') {
    if (value.displayOrder !== undefined) data.displayOrder = integer(value.displayOrder, 'displayOrder');
  }
  if (resource === 'processes') {
    if (value.unit !== undefined) data.unit = optionalText(value.unit, 'unit', 30) ?? 'PIECE';
    if (value.defaultStandardSeconds !== undefined) data.defaultStandardSeconds = optionalInteger(value.defaultStandardSeconds, 'defaultStandardSeconds');
    if (value.defaultPieceRate !== undefined) data.defaultPieceRate = optionalMoney(value.defaultPieceRate, 'defaultPieceRate') ?? new Prisma.Decimal(0);
  }
  if (Object.keys(data).length === 0) {
    throw new BadRequestException('Request body must contain at least one field applicable to this resource');
  }
  return data;
}

async function createRecord(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  resource: MasterResource,
  input: MasterInput,
): Promise<MasterRecord> {
  switch (resource) {
    case 'customers':
      return transaction.customer.create({ data: { factoryId, code: input.code, name: input.name, status: input.status } });
    case 'styles':
      return transaction.style.create({ data: {
        factoryId,
        code: input.code,
        name: input.name,
        status: input.status,
        customerId: input.customerId,
        customerStyleNo: input.customerStyleNo,
        imageUrl: input.imageUrl,
        versionName: input.versionName,
      } });
    case 'colors':
      return transaction.color.create({ data: { factoryId, code: input.code, name: input.name, status: input.status, displayOrder: input.displayOrder } });
    case 'sizes':
      return transaction.size.create({ data: { factoryId, code: input.code, name: input.name, status: input.status, displayOrder: input.displayOrder } });
    case 'processes':
      return transaction.process.create({ data: {
        factoryId,
        code: input.code,
        name: input.name,
        status: input.status,
        unit: input.unit ?? 'PIECE',
        defaultStandardSeconds: input.defaultStandardSeconds,
        defaultPieceRate: input.defaultPieceRate ?? new Prisma.Decimal(0),
      } });
  }
}

async function updateRecord(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  resource: MasterResource,
  resourceId: string,
  version: number,
  data: Record<string, unknown>,
): Promise<MasterRecord | null> {
  const update = { ...data, version: { increment: 1 } };
  let count: number;
  switch (resource) {
    case 'customers':
      count = (await transaction.customer.updateMany({ where: { id: resourceId, factoryId, version, deletedAt: null }, data: update })).count;
      break;
    case 'styles':
      count = (await transaction.style.updateMany({ where: { id: resourceId, factoryId, version, deletedAt: null }, data: update })).count;
      break;
    case 'colors':
      count = (await transaction.color.updateMany({ where: { id: resourceId, factoryId, version }, data: update })).count;
      break;
    case 'sizes':
      count = (await transaction.size.updateMany({ where: { id: resourceId, factoryId, version }, data: update })).count;
      break;
    case 'processes':
      count = (await transaction.process.updateMany({ where: { id: resourceId, factoryId, version }, data: update })).count;
      break;
  }
  if (count !== 1) return null;
  switch (resource) {
    case 'customers': return transaction.customer.findUnique({ where: { id: resourceId } });
    case 'styles': return transaction.style.findUnique({ where: { id: resourceId } });
    case 'colors': return transaction.color.findUnique({ where: { id: resourceId } });
    case 'sizes': return transaction.size.findUnique({ where: { id: resourceId } });
    case 'processes': return transaction.process.findUnique({ where: { id: resourceId } });
  }
}

export function serializeMaster(resource: MasterResource, record: MasterRecord): Record<string, unknown> {
  const base = {
    id: record.id,
    factoryId: record.factoryId,
    resourceType: resource,
    code: record.code,
    name: record.name ?? record.code,
    status: record.status,
    customerId: null,
    customerStyleNo: null,
    imageUrl: null,
    versionName: null,
    displayOrder: null,
    unit: null,
    defaultStandardSeconds: null,
    defaultPieceRate: null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    version: record.version,
  };
  switch (resource) {
    case 'styles': {
      const style = record as Style;
      return { ...base, customerId: style.customerId, customerStyleNo: style.customerStyleNo, imageUrl: style.imageUrl, versionName: style.versionName };
    }
    case 'colors': return { ...base, displayOrder: (record as Color).displayOrder };
    case 'sizes': return { ...base, displayOrder: (record as Size).displayOrder };
    case 'processes': {
      const process = record as Process;
      return {
        ...base,
        unit: process.unit,
        defaultStandardSeconds: process.defaultStandardSeconds,
        defaultPieceRate: process.defaultPieceRate.toFixed(4),
      };
    }
    default: return base;
  }
}

function optionalUri(value: unknown, name: string): string | null {
  const normalized = optionalText(value, name, 2_000);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new BadRequestException(`${name} must be an absolute HTTP(S) URL`);
  }
}

function optionalMoney(value: unknown, name: string): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,4})?$/.test(String(value))) {
    throw new BadRequestException(`${name} must be a non-negative amount with at most 4 decimal places`);
  }
  const amount = new Prisma.Decimal(value);
  if (amount.gt('9999999999.9999')) throw new BadRequestException(`${name} is too large`);
  return amount;
}

function translateConstraint(error: unknown, message: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException(message);
    if (error.code === 'P2003') return new UnprocessableEntityException('Referenced master data is invalid');
  }
  return error;
}
