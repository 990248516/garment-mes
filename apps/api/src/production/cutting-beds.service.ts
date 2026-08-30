import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';
import { cuttingBedInclude, serializeCuttingBed } from './serializers';
import {
  calendarDate,
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
} from './validation';

const CUTTING_STATUSES = ['DRAFT', 'CUTTING', 'CUT', 'RELEASED', 'CANCELLED'] as const;

export interface CuttingBedListQuery {
  cursor?: unknown;
  limit?: unknown;
  orderId?: unknown;
  cuttingStatus?: unknown;
  cutDateFrom?: unknown;
  cutDateTo?: unknown;
}

@Injectable()
export class CuttingBedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(factoryId: string, actorUserId: string, requestId: string, body: unknown): Promise<Record<string, unknown>> {
    const value = objectBody(body);
    const input = {
      orderId: uuid(value.orderId, 'orderId'),
      bedNo: text(value.bedNo, 'bedNo', 40),
      cutDate: calendarDate(value.cutDate, 'cutDate'),
      plyCount: optionalInteger(value.plyCount, 'plyCount', 1),
      dyeLotNo: optionalText(value.dyeLotNo, 'dyeLotNo', 60),
      supervisorWorkerId: optionalUuid(value.supervisorWorkerId, 'supervisorWorkerId'),
      notes: optionalText(value.notes, 'notes', 1000),
    };
    try {
      return await this.idempotency.execute(factoryId, requestId, 'cutting-beds:create', body, 201, async (transaction) => {
        const [order, supervisor] = await Promise.all([
          transaction.productionOrder.findFirst({ where: { id: input.orderId, factoryId }, select: { status: true } }),
          input.supervisorWorkerId
            ? transaction.worker.findFirst({ where: { id: input.supervisorWorkerId, factoryId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })
            : null,
        ]);
        if (!order) throw new UnprocessableEntityException('orderId does not belong to this factory');
        if (!['RELEASED', 'IN_PROGRESS'].includes(order.status)) {
          throw new UnprocessableEntityException('Only released or in-progress orders may be cut');
        }
        if (input.supervisorWorkerId && !supervisor) {
          throw new UnprocessableEntityException('supervisorWorkerId is not active in this factory');
        }
        const bed = await transaction.cuttingBed.create({
          data: { factoryId, ...input, createdBy: actorUserId },
          include: cuttingBedInclude,
        });
        return serializeCuttingBed(bed);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('bedNo already exists in this factory');
      }
      throw error;
    }
  }

  async list(factoryId: string, query: CuttingBedListQuery): Promise<Record<string, unknown>> {
    const cursor = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const orderId = query.orderId === undefined ? undefined : uuid(query.orderId, 'orderId');
    const status = oneOf(query.cuttingStatus, 'cuttingStatus', CUTTING_STATUSES);
    const from = query.cutDateFrom === undefined ? undefined : calendarDate(query.cutDateFrom, 'cutDateFrom');
    const to = query.cutDateTo === undefined ? undefined : calendarDate(query.cutDateTo, 'cutDateTo');
    if (from && to && to < from) throw new UnprocessableEntityException('cutDateTo must not precede cutDateFrom');
    const where: Prisma.CuttingBedWhereInput = {
      factoryId,
      ...(orderId ? { orderId } : {}),
      ...(status ? { status } : {}),
      ...(from || to ? { cutDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [records, total] = await Promise.all([
      this.prisma.cuttingBed.findMany({
        where,
        include: cuttingBedInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      this.prisma.cuttingBed.count({ where }),
    ]);
    const hasMore = records.length > limit;
    const items = records.slice(0, limit);
    return {
      items: items.map(serializeCuttingBed),
      page: { nextCursor: hasMore ? encodeCursor(items.at(-1)!.id) : null, hasMore, total },
    };
  }

  async get(factoryId: string, cuttingBedIdValue: unknown): Promise<Record<string, unknown>> {
    const cuttingBedId = uuid(cuttingBedIdValue, 'cuttingBedId');
    const bed = await this.prisma.cuttingBed.findFirst({
      where: { id: cuttingBedId, factoryId },
      include: cuttingBedInclude,
    });
    if (!bed) throw new NotFoundException('Cutting bed not found');
    return serializeCuttingBed(bed);
  }
}
