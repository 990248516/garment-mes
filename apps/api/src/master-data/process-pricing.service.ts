import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../production/idempotency.service';
import { integer, objectBody, text, uuid } from '../production/validation';
import { serializeMaster } from './master-data.service';

interface ProcessRateAdjustmentInput {
  expectedVersion: number;
  unitRate: Prisma.Decimal;
  applyToHistoricalBundles: boolean;
  reason: string | null;
}

@Injectable()
export class ProcessPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async adjustRate(
    factoryId: string,
    actorUserId: string,
    requestId: string,
    processIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const processId = uuid(processIdValue, 'processId');
    const input = normalizeProcessRateAdjustment(body);
    return this.idempotency.execute(
      factoryId,
      requestId,
      `processes:${processId}:adjust-rate:v${input.expectedVersion}`,
      body,
      200,
      async (transaction) => {
        const process = await transaction.process.findFirst({
          where: { id: processId, factoryId },
        });
        if (!process) throw new NotFoundException('Process not found');
        if (process.version !== input.expectedVersion) {
          throw new ConflictException(`Version mismatch; current version is ${process.version}`);
        }

        const updatedCount = (await transaction.process.updateMany({
          where: { id: processId, factoryId, version: input.expectedVersion },
          data: {
            defaultPieceRate: input.unitRate,
            version: { increment: 1 },
          },
        })).count;
        if (updatedCount !== 1) throw new ConflictException('Process was updated concurrently');

        const updatedRouteSteps = (await transaction.routeStep.updateMany({
          where: {
            factoryId,
            processId,
            OR: [{ pieceRate: null }, { pieceRate: process.defaultPieceRate }],
          },
          data: { pieceRate: input.unitRate },
        })).count;

        let updatedBundleSteps = 0;
        let updatedActiveReports = 0;
        let createdAdjustments = 0;
        let totalAdjustmentAmount = new Prisma.Decimal(0);

        if (input.applyToHistoricalBundles) {
          const steps = await transaction.bundleRouteStep.findMany({
            where: {
              factoryId,
              processId,
              pieceRateSnapshot: { not: input.unitRate },
            },
            include: {
              workReports: {
                include: { pieceworkEntries: true },
              },
            },
          });
          const stepIds = steps.map((step) => step.id);
          if (stepIds.length > 0) {
            updatedActiveReports = (await transaction.workReport.updateMany({
              where: {
                factoryId,
                bundleRouteStepId: { in: stepIds },
                status: 'STARTED',
              },
              data: { unitRateSnapshot: input.unitRate },
            })).count;
          }

          for (const step of steps) {
            await transaction.bundleRouteStep.update({
              where: { id: step.id },
              data: {
                pieceRateSnapshot: input.unitRate,
                version: { increment: 1 },
              },
            });
            updatedBundleSteps += 1;

            for (const report of step.workReports.filter((item) => item.status === 'COMPLETED')) {
              const original = report.pieceworkEntries.find((entry) => entry.adjustmentOfId === null);
              if (!original) continue;
              const effectiveAmount = report.pieceworkEntries
                .filter((entry) => entry.status !== 'REVERSED')
                .reduce((sum, entry) => sum.add(entry.amount), new Prisma.Decimal(0));
              const desiredAmount = input.unitRate.mul(original.quantity);
              const difference = desiredAmount.sub(effectiveAmount);
              if (difference.eq(0)) continue;
              await transaction.pieceworkEntry.create({
                data: {
                  factoryId,
                  workReportId: report.id,
                  workerId: report.workerId,
                  processId,
                  quantity: original.quantity,
                  unitRate: input.unitRate,
                  amount: difference,
                  status: 'PENDING',
                  adjustmentOfId: original.id,
                  reason: input.reason,
                },
              });
              createdAdjustments += 1;
              totalAdjustmentAmount = totalAdjustmentAmount.add(difference);
            }

            await transaction.bundleEvent.create({
              data: {
                factoryId,
                bundleId: step.bundleId,
                eventType: 'PRICE_ADJUSTED',
                actorUserId,
                payload: {
                  bundleRouteStepId: step.id,
                  processId,
                  previousRate: step.pieceRateSnapshot.toFixed(4),
                  nextRate: input.unitRate.toFixed(4),
                  reason: input.reason,
                },
              },
            });
          }
        }

        const updatedProcess = await transaction.process.findUniqueOrThrow({
          where: { id: processId },
        });
        return {
          process: serializeMaster('processes', updatedProcess),
          updatedRouteSteps,
          updatedBundleSteps,
          updatedActiveReports,
          createdAdjustments,
          totalAdjustmentAmount: totalAdjustmentAmount.toFixed(4),
          serverTime: new Date().toISOString(),
        };
      },
    );
  }
}

export function normalizeProcessRateAdjustment(body: unknown): ProcessRateAdjustmentInput {
  const value = objectBody(body);
  const expectedVersion = integer(value.expectedVersion, 'expectedVersion', 1);
  const unitRate = money(value.unitRate, 'unitRate');
  if (typeof value.applyToHistoricalBundles !== 'boolean') {
    throw new BadRequestException('applyToHistoricalBundles must be boolean');
  }
  const reason = value.reason === undefined || value.reason === null || value.reason === ''
    ? null
    : text(value.reason, 'reason', 500);
  if (value.applyToHistoricalBundles && !reason) {
    throw new BadRequestException('reason is required when historical bundles are adjusted');
  }
  return {
    expectedVersion,
    unitRate,
    applyToHistoricalBundles: value.applyToHistoricalBundles,
    reason,
  };
}

function money(value: unknown, name: string): Prisma.Decimal {
  if ((typeof value !== 'string' && typeof value !== 'number') || !/^\d+(?:\.\d{1,4})?$/.test(String(value))) {
    throw new BadRequestException(`${name} must be a non-negative amount with at most 4 decimal places`);
  }
  const amount = new Prisma.Decimal(value);
  if (amount.gt('9999999999.9999')) throw new BadRequestException(`${name} is too large`);
  return amount;
}
