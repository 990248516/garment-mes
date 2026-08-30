import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from '../production/idempotency.service';
import { calendarDate, integer, objectBody, uuid } from '../production/validation';

export interface SkillInput {
  processId: string;
  level: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

@Injectable()
export class WorkerSkillsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async list(factoryId: string, workerIdValue: unknown): Promise<Record<string, unknown>[]> {
    const workerId = uuid(workerIdValue, 'workerId');
    await requireWorker(this.prisma, factoryId, workerId);
    const skills = await this.prisma.workerSkill.findMany({
      where: { workerId },
      include: { process: true },
      orderBy: [{ process: { name: 'asc' } }, { effectiveFrom: 'desc' }],
    });
    return skills.map(serializeWorkerSkill);
  }

  async replace(
    factoryId: string,
    requestId: string,
    workerIdValue: unknown,
    body: unknown,
  ): Promise<Record<string, unknown>[]> {
    const workerId = uuid(workerIdValue, 'workerId');
    const inputs = normalizeSkillReplacement(body);
    return this.idempotency.execute(
      factoryId,
      requestId,
      `workers:${workerId}:skills:replace`,
      body,
      200,
      async (transaction) => {
        await requireWorker(transaction, factoryId, workerId);
        const processIds = [...new Set(inputs.map((input) => input.processId))];
        const processCount = await transaction.process.count({
          where: { id: { in: processIds }, factoryId, status: 'ACTIVE' },
        });
        if (processCount !== processIds.length) {
          throw new UnprocessableEntityException('One or more processId values are not active in this factory');
        }

        await transaction.workerSkill.deleteMany({ where: { workerId } });
        if (inputs.length > 0) {
          await transaction.workerSkill.createMany({
            data: inputs.map((input) => ({
              workerId,
              processId: input.processId,
              skillLevel: input.level,
              effectiveFrom: input.effectiveFrom,
              effectiveTo: input.effectiveTo,
            })),
          });
        }
        const skills = await transaction.workerSkill.findMany({
          where: { workerId },
          include: { process: true },
          orderBy: [{ process: { name: 'asc' } }, { effectiveFrom: 'desc' }],
        });
        return skills.map(serializeWorkerSkill);
      },
    );
  }
}

export function normalizeSkillReplacement(body: unknown, today = new Date()): SkillInput[] {
  const value = objectBody(body);
  if (!Array.isArray(value.skills)) throw new BadRequestException('skills must be an array');
  if (value.skills.length > 500) throw new BadRequestException('skills may contain at most 500 entries');
  const defaultDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const inputs = value.skills.map((raw, index) => {
    const skill = objectBody(raw);
    const effectiveFrom = skill.effectiveFrom === undefined || skill.effectiveFrom === null || skill.effectiveFrom === ''
      ? defaultDate
      : calendarDate(skill.effectiveFrom, `skills[${index}].effectiveFrom`);
    const effectiveTo = skill.effectiveTo === undefined || skill.effectiveTo === null || skill.effectiveTo === ''
      ? null
      : calendarDate(skill.effectiveTo, `skills[${index}].effectiveTo`);
    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new BadRequestException(`skills[${index}].effectiveTo must not precede effectiveFrom`);
    }
    return {
      processId: uuid(skill.processId, `skills[${index}].processId`),
      level: integer(skill.level, `skills[${index}].level`, 1, 5),
      effectiveFrom,
      effectiveTo,
    };
  });
  const keys = inputs.map((input) => `${input.processId}:${input.effectiveFrom.toISOString().slice(0, 10)}`);
  if (new Set(keys).size !== keys.length) {
    throw new BadRequestException('skills must not repeat the same processId and effectiveFrom');
  }
  return inputs;
}

async function requireWorker(
  client: PrismaService | Prisma.TransactionClient,
  factoryId: string,
  workerId: string,
): Promise<void> {
  const worker = await client.worker.findFirst({
    where: { id: workerId, factoryId, deletedAt: null },
    select: { id: true },
  });
  if (!worker) throw new NotFoundException('Worker not found');
}

export function serializeWorkerSkill(skill: {
  id: string;
  workerId: string;
  processId: string;
  skillLevel: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  process: { code: string; name: string };
}): Record<string, unknown> {
  return {
    id: skill.id,
    workerId: skill.workerId,
    processId: skill.processId,
    processCode: skill.process.code,
    processName: skill.process.name,
    level: skill.skillLevel,
    effectiveFrom: skill.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: skill.effectiveTo?.toISOString().slice(0, 10) ?? null,
  };
}
