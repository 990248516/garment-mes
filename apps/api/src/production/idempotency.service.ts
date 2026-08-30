import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async execute<T>(
    factoryId: string,
    requestId: string,
    scope: string,
    request: unknown,
    responseStatus: number,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const requestHash = hashRequest(request);
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { factoryId_scope_requestId: { factoryId, scope, requestId } },
    });
    if (existing && existing.expiresAt > new Date()) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Idempotency-Key was already used with a different request');
      }
      if (existing.responseStatus === null || existing.responseBody === null) {
        throw new ConflictException('The idempotent request is still in progress');
      }
      return existing.responseBody as T;
    }

    return this.prisma.$transaction(async (transaction) => {
      if (existing) await transaction.idempotencyRecord.delete({ where: { id: existing.id } });
      const record = await transaction.idempotencyRecord.create({
        data: {
          factoryId,
          requestId,
          scope,
          requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      const result = await operation(transaction);
      const responseBody = JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue;
      await transaction.idempotencyRecord.update({
        where: { id: record.id },
        data: { responseStatus, responseBody },
      });
      return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}
