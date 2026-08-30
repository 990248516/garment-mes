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
import { objectBody, text, uuid } from '../production/validation';

const WORKER_ROLE_CODE = 'WORKER_OPERATOR';
const WORKER_PERMISSIONS = [
  'bundle:read',
  'bundle:scan',
  'work-report:start',
  'work-report:complete',
  'self:piecework:read',
];

export interface WorkerAccountCreateInput {
  workerId: string;
  username: string;
  displayName: string;
  password: string;
}

@Injectable()
export class WorkerAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(factoryId: string): Promise<Record<string, unknown>> {
    const workers = await this.prisma.worker.findMany({
      where: { factoryId, deletedAt: null },
      include: { user: true },
      orderBy: [{ status: 'asc' }, { workerNo: 'asc' }],
      take: 500,
    });
    return {
      items: workers.map((worker) => serializeWorkerAccount(worker)),
      page: { nextCursor: null, hasMore: false, total: workers.length },
    };
  }

  async create(factoryId: string, body: unknown): Promise<Record<string, unknown>> {
    const input = normalizeWorkerAccountCreate(body);
    const passwordHash = await hashSecret(input.password);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const worker = await transaction.worker.findFirst({
          where: { id: input.workerId, factoryId, deletedAt: null },
          include: { factory: true },
        });
        if (!worker) throw new NotFoundException('Worker not found');
        if (worker.userId) throw new ConflictException('Worker already has a login account');
        if (worker.status === 'LEFT') throw new UnprocessableEntityException('Departed worker cannot receive an account');

        const role = await transaction.role.upsert({
          where: {
            organizationId_code: {
              organizationId: worker.factory.organizationId,
              code: WORKER_ROLE_CODE,
            },
          },
          update: {
            name: '一线员工',
            permissions: WORKER_PERMISSIONS,
            dataScope: 'SELF',
          },
          create: {
            organizationId: worker.factory.organizationId,
            code: WORKER_ROLE_CODE,
            name: '一线员工',
            permissions: WORKER_PERMISSIONS,
            dataScope: 'SELF',
          },
        });
        const user = await transaction.appUser.create({
          data: {
            organizationId: worker.factory.organizationId,
            username: input.username,
            displayName: input.displayName,
            passwordHash,
            status: 'ACTIVE',
            roleAssignments: { create: { roleId: role.id, factoryId } },
          },
        });
        await transaction.worker.update({ where: { id: worker.id }, data: { userId: user.id } });
        return serializeWorkerAccount({ ...worker, user });
      });
    } catch (error) {
      throw translateAccountConstraint(error);
    }
  }

  async setStatus(factoryId: string, userIdValue: unknown, body: unknown): Promise<Record<string, unknown>> {
    const userId = uuid(userIdValue, 'userId');
    const status = normalizeAccountStatus(body);
    return this.prisma.$transaction(async (transaction) => {
      const worker = await requireWorkerAccount(transaction, factoryId, userId);
      const user = await transaction.appUser.update({ where: { id: userId }, data: { status } });
      await revokeSessions(transaction, userId);
      return serializeWorkerAccount({ ...worker, user });
    });
  }

  async resetPassword(factoryId: string, userIdValue: unknown, body: unknown): Promise<Record<string, unknown>> {
    const userId = uuid(userIdValue, 'userId');
    const password = normalizePasswordReset(body);
    const passwordHash = await hashSecret(password);
    return this.prisma.$transaction(async (transaction) => {
      const worker = await requireWorkerAccount(transaction, factoryId, userId);
      const user = await transaction.appUser.update({ where: { id: userId }, data: { passwordHash } });
      await revokeSessions(transaction, userId);
      return serializeWorkerAccount({ ...worker, user });
    });
  }
}

export function normalizeWorkerAccountCreate(body: unknown): WorkerAccountCreateInput {
  const value = objectBody(body);
  return {
    workerId: uuid(value.workerId, 'workerId'),
    username: text(value.username, 'username', 80),
    displayName: text(value.displayName, 'displayName', 100),
    password: accountPassword(value.password),
  };
}

export function normalizeAccountStatus(body: unknown): 'ACTIVE' | 'INACTIVE' {
  const value = objectBody(body);
  if (value.status !== 'ACTIVE' && value.status !== 'INACTIVE') {
    throw new BadRequestException('status must be ACTIVE or INACTIVE');
  }
  return value.status;
}

export function normalizePasswordReset(body: unknown): string {
  return accountPassword(objectBody(body).password);
}

function accountPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) {
    throw new BadRequestException('password must contain 8-200 characters');
  }
  return value;
}

async function requireWorkerAccount(
  transaction: Prisma.TransactionClient,
  factoryId: string,
  userId: string,
) {
  const worker = await transaction.worker.findFirst({
    where: { factoryId, userId, deletedAt: null },
    include: { user: true },
  });
  if (!worker?.user) throw new NotFoundException('Worker account not found');
  return worker;
}

async function revokeSessions(transaction: Prisma.TransactionClient, userId: string): Promise<void> {
  await transaction.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function serializeWorkerAccount(worker: {
  id: string;
  workerNo: string;
  name: string;
  status: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    status: string;
    lastLoginAt: Date | null;
  } | null;
}): Record<string, unknown> {
  return {
    workerId: worker.id,
    workerNo: worker.workerNo,
    workerName: worker.name,
    workerStatus: worker.status,
    userId: worker.user?.id ?? null,
    username: worker.user?.username ?? null,
    displayName: worker.user?.displayName ?? null,
    accountStatus: worker.user?.status ?? null,
    lastLoginAt: worker.user?.lastLoginAt?.toISOString() ?? null,
  };
}

function translateAccountConstraint(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new ConflictException('Username already exists in this organization');
  }
  return error;
}
