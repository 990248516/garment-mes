import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { ifMatchVersion } from '../master-data/master-data.service';
import { orderInclude, serializeOrder } from './serializers';
import {
  calendarDate,
  decodeCursor,
  encodeCursor,
  integer,
  objectBody,
  oneOf,
  optionalDate,
  optionalText,
  optionalUuid,
  pageLimit,
  text,
  uuid,
} from './validation';

const ORDER_STATUSES = ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

interface OrderItemInput {
  lineNo: number;
  colorId: string;
  sizeId: string;
  dyeLotNo: string | null;
  plannedQty: number;
  overproductionLimit: number;
}

interface OrderPatchInput {
  customerId?: string | null;
  styleId?: string;
  plannedStartDate?: Date | null;
  dueDate?: Date | null;
  externalRef?: string | null;
  notes?: string | null;
  items?: OrderItemInput[];
}

interface OrderCreateInput {
  orderNo: string;
  customerId: string | null;
  styleId: string;
  plannedStartDate: Date | null;
  dueDate: Date | null;
  externalRef: string | null;
  notes: string | null;
  items: OrderItemInput[];
}

export interface OrderListQuery {
  cursor?: unknown;
  limit?: unknown;
  q?: unknown;
  orderStatus?: unknown;
  customerId?: unknown;
  styleId?: unknown;
  dueFrom?: unknown;
  dueTo?: unknown;
  sort?: unknown;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(factoryId: string, actorUserId: string, requestId: string, body: unknown): Promise<Record<string, unknown>> {
    const input = normalizeOrderCreate(body);
    try {
      return await this.idempotency.execute(factoryId, requestId, 'orders:create', body, 201, async (transaction) => {
        await validateMasterData(transaction, factoryId, input);
        const order = await transaction.productionOrder.create({
          data: {
            factoryId,
            orderNo: input.orderNo,
            customerId: input.customerId,
            styleId: input.styleId,
            plannedStartDate: input.plannedStartDate,
            dueDate: input.dueDate,
            totalPlannedQty: input.items.reduce((total, item) => total + item.plannedQty, 0),
            externalRef: input.externalRef,
            notes: input.notes,
            createdBy: actorUserId,
            updatedBy: actorUserId,
            items: {
              create: input.items.map((item) => ({ factoryId, ...item })),
            },
          },
          include: orderInclude,
        });
        return serializeOrder(order);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Order number or line number already exists');
      throw error;
    }
  }

  async update(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    ifMatchValue: string | string[] | undefined,
    orderIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const orderId = uuid(orderIdValue, 'orderId');
    const expectedVersion = ifMatchVersion(ifMatchValue);
    const input = normalizeOrderPatch(body);
    try {
      return await this.idempotency.execute(
        factoryId,
        requestId,
        `orders:${orderId}:update:v${expectedVersion}`,
        { body, expectedVersion },
        200,
        async (transaction) => {
          const existing = await transaction.productionOrder.findFirst({
            where: { id: orderId, factoryId },
            include: { items: true },
          });
          if (!existing) throw new NotFoundException('Order not found');
          if (existing.status !== 'DRAFT') throw new ConflictException('Only draft orders may be edited');
          if (existing.version !== expectedVersion) {
            throw new ConflictException(`Version mismatch; current version is ${existing.version}`);
          }
          const nextItems = input.items ?? existing.items.map((item) => ({
            lineNo: item.lineNo,
            colorId: item.colorId,
            sizeId: item.sizeId,
            dyeLotNo: item.dyeLotNo,
            plannedQty: item.plannedQty,
            overproductionLimit: item.overproductionLimit,
          }));
          const next = {
            customerId: input.customerId === undefined ? existing.customerId : input.customerId,
            styleId: input.styleId ?? existing.styleId,
            plannedStartDate: input.plannedStartDate === undefined ? existing.plannedStartDate : input.plannedStartDate,
            dueDate: input.dueDate === undefined ? existing.dueDate : input.dueDate,
            externalRef: input.externalRef === undefined ? existing.externalRef : input.externalRef,
            notes: input.notes === undefined ? existing.notes : input.notes,
            items: nextItems,
          };
          if (next.plannedStartDate && next.dueDate && next.dueDate < next.plannedStartDate) {
            throw new UnprocessableEntityException('dueDate must not precede plannedStartDate');
          }
          await validateMasterData(transaction, factoryId, next);
          const updated = await transaction.productionOrder.updateMany({
            where: { id: orderId, factoryId, status: 'DRAFT', version: expectedVersion },
            data: {
              customerId: next.customerId,
              styleId: next.styleId,
              plannedStartDate: next.plannedStartDate,
              dueDate: next.dueDate,
              externalRef: next.externalRef,
              notes: next.notes,
              totalPlannedQty: nextItems.reduce((total, item) => total + item.plannedQty, 0),
              updatedBy: actorUserId,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new ConflictException('Order was updated concurrently');
          if (input.items) {
            await transaction.productionOrderItem.deleteMany({ where: { orderId } });
            await transaction.productionOrderItem.createMany({
              data: nextItems.map((item) => ({ factoryId, orderId, ...item })),
            });
          }
          const order = await transaction.productionOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: orderInclude,
          });
          return serializeOrder(order);
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Order line number already exists');
      throw error;
    }
  }

  async release(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    orderIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const orderId = uuid(orderIdValue, 'orderId');
    const requestBody = body ?? {};
    if (body !== undefined && body !== null) {
      const value = objectBody(body);
      optionalText(value.reason, 'reason', 1000);
    }
    return this.idempotency.execute(
      factoryId,
      requestId,
      `orders:${orderId}:release`,
      requestBody,
      200,
      async (transaction) => {
        const order = await transaction.productionOrder.findFirst({
          where: { id: orderId, factoryId },
          select: { id: true, styleId: true, status: true },
        });
        if (!order) throw new NotFoundException('Order not found');
        if (order.status !== 'DRAFT') {
          throw new ConflictException('Only draft orders may be released');
        }
        const publishedRoute = await transaction.routeVersion.findFirst({
          where: { factoryId, styleId: order.styleId, status: 'PUBLISHED' },
          select: { id: true },
        });
        if (!publishedRoute) {
          throw new UnprocessableEntityException('A published route is required before order release');
        }
        const released = await transaction.productionOrder.update({
          where: { id: orderId },
          data: { status: 'RELEASED', updatedBy: actorUserId, version: { increment: 1 } },
          include: orderInclude,
        });
        return serializeOrder(released);
      },
    );
  }

  async list(factoryId: string, query: OrderListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const search = query.q === undefined ? undefined : text(query.q, 'q', 100);
    const status = oneOf(query.orderStatus, 'orderStatus', ORDER_STATUSES);
    const customerId = query.customerId === undefined ? undefined : uuid(query.customerId, 'customerId');
    const styleId = query.styleId === undefined ? undefined : uuid(query.styleId, 'styleId');
    const dueFrom = query.dueFrom === undefined ? undefined : calendarDate(query.dueFrom, 'dueFrom');
    const dueTo = query.dueTo === undefined ? undefined : calendarDate(query.dueTo, 'dueTo');
    const sort = oneOf(query.sort, 'sort', ['createdAt', '-createdAt', 'dueDate', '-dueDate', 'orderNo', '-orderNo'] as const) ?? '-createdAt';
    if (dueFrom && dueTo && dueTo < dueFrom) throw new UnprocessableEntityException('dueTo must not precede dueFrom');

    const where: Prisma.ProductionOrderWhereInput = {
      factoryId,
      ...(search ? { OR: [{ orderNo: { contains: search, mode: 'insensitive' } }, { externalRef: { contains: search, mode: 'insensitive' } }] } : {}),
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(styleId ? { styleId } : {}),
      ...(dueFrom || dueTo ? { dueDate: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) } } : {}),
    };
    const orderBy = orderByFor(sort);
    const [records, total] = await Promise.all([
      this.prisma.productionOrder.findMany({
        where,
        include: orderInclude,
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.productionOrder.count({ where }),
    ]);
    const hasMore = records.length > limit;
    const pageRecords = records.slice(0, limit);
    return {
      items: pageRecords.map(serializeOrder),
      page: {
        nextCursor: hasMore ? encodeCursor(pageRecords.at(-1)!.id) : null,
        hasMore,
        total,
      },
    };
  }

  async get(factoryId: string, orderIdValue: unknown): Promise<Record<string, unknown>> {
    const orderId = uuid(orderIdValue, 'orderId');
    const order = await this.prisma.productionOrder.findFirst({
      where: { id: orderId, factoryId },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return serializeOrder(order);
  }
}

function normalizeOrderCreate(body: unknown): OrderCreateInput {
  const value = objectBody(body);
  const items = normalizeOrderItems(value.items);
  const plannedStartDate = optionalDate(value.plannedStartDate, 'plannedStartDate');
  const dueDate = optionalDate(value.dueDate, 'dueDate');
  if (plannedStartDate && dueDate && dueDate < plannedStartDate) {
    throw new UnprocessableEntityException('dueDate must not precede plannedStartDate');
  }
  return {
    orderNo: text(value.orderNo, 'orderNo', 60),
    customerId: optionalUuid(value.customerId, 'customerId'),
    styleId: uuid(value.styleId, 'styleId'),
    plannedStartDate,
    dueDate,
    externalRef: optionalText(value.externalRef, 'externalRef', 100),
    notes: optionalText(value.notes, 'notes', 2000),
    items,
  };
}

export function normalizeOrderPatch(body: unknown): OrderPatchInput {
  const value = objectBody(body);
  const input: OrderPatchInput = {};
  if (value.customerId !== undefined) input.customerId = optionalUuid(value.customerId, 'customerId');
  if (value.styleId !== undefined) input.styleId = uuid(value.styleId, 'styleId');
  if (value.plannedStartDate !== undefined) input.plannedStartDate = optionalDate(value.plannedStartDate, 'plannedStartDate');
  if (value.dueDate !== undefined) input.dueDate = optionalDate(value.dueDate, 'dueDate');
  if (value.externalRef !== undefined) input.externalRef = optionalText(value.externalRef, 'externalRef', 100);
  if (value.notes !== undefined) input.notes = optionalText(value.notes, 'notes', 2000);
  if (value.items !== undefined) input.items = normalizeOrderItems(value.items);
  if (Object.keys(input).length === 0) throw new BadRequestException('Request body must contain at least one order field');
  return input;
}

function normalizeOrderItems(value: unknown): OrderItemInput[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new UnprocessableEntityException('items must contain at least one order line');
  }
  const items = value.map((raw, index) => {
    const item = objectBody(raw);
    return {
      lineNo: integer(item.lineNo, `items[${index}].lineNo`, 1),
      colorId: uuid(item.colorId, `items[${index}].colorId`),
      sizeId: uuid(item.sizeId, `items[${index}].sizeId`),
      dyeLotNo: optionalText(item.dyeLotNo, `items[${index}].dyeLotNo`, 60),
      plannedQty: integer(item.plannedQty, `items[${index}].plannedQty`, 1),
      overproductionLimit: item.overproductionLimit === undefined ? 0 : integer(item.overproductionLimit, `items[${index}].overproductionLimit`),
    };
  });
  if (new Set(items.map((item) => item.lineNo)).size !== items.length) {
    throw new UnprocessableEntityException('Order lineNo values must be unique');
  }
  return items;
}

async function validateMasterData(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  input: Pick<OrderCreateInput, 'styleId' | 'customerId' | 'items'>,
): Promise<void> {
  const [style, customer, colors, sizes] = await Promise.all([
    transaction.style.findFirst({ where: { id: input.styleId, factoryId, status: 'ACTIVE', deletedAt: null }, select: { id: true } }),
    input.customerId ? transaction.customer.findFirst({ where: { id: input.customerId, factoryId, status: 'ACTIVE', deletedAt: null }, select: { id: true } }) : null,
    transaction.color.count({ where: { id: { in: [...new Set(input.items.map((item) => item.colorId))] }, factoryId, status: 'ACTIVE' } }),
    transaction.size.count({ where: { id: { in: [...new Set(input.items.map((item) => item.sizeId))] }, factoryId, status: 'ACTIVE' } }),
  ]);
  if (!style) throw new UnprocessableEntityException('styleId is not active in this factory');
  if (input.customerId && !customer) throw new UnprocessableEntityException('customerId is not active in this factory');
  if (colors !== new Set(input.items.map((item) => item.colorId)).size) throw new UnprocessableEntityException('One or more colorId values are invalid');
  if (sizes !== new Set(input.items.map((item) => item.sizeId)).size) throw new UnprocessableEntityException('One or more sizeId values are invalid');
}

function orderByFor(sort: string): Prisma.ProductionOrderOrderByWithRelationInput[] {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  return [{ [field]: descending ? 'desc' : 'asc' }, { id: descending ? 'desc' : 'asc' }];
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
