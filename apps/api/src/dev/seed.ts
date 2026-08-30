import { createHash } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { hashSecret } from '../auth/password';

export const DEV_SEED = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  factoryId: '10000000-0000-4000-8000-000000000002',
  userId: '10000000-0000-4000-8000-000000000003',
  roleId: '10000000-0000-4000-8000-000000000004',
  userRoleId: '10000000-0000-4000-8000-000000000005',
  workerId: '10000000-0000-4000-8000-000000000006',
  customerId: '10000000-0000-4000-8000-000000000007',
  styleId: '10000000-0000-4000-8000-000000000008',
  colorId: '10000000-0000-4000-8000-000000000009',
  sizeId: '10000000-0000-4000-8000-000000000010',
  processId: '10000000-0000-4000-8000-000000000011',
  routeVersionId: '10000000-0000-4000-8000-000000000012',
  routeStepId: '10000000-0000-4000-8000-000000000013',
  orderId: '10000000-0000-4000-8000-000000000014',
  orderItemId: '10000000-0000-4000-8000-000000000015',
  cuttingBedId: '10000000-0000-4000-8000-000000000016',
  bundleId: '10000000-0000-4000-8000-000000000017',
  bundleRouteStepId: '10000000-0000-4000-8000-000000000018',
  bundleNo: '10605-2',
  bundleShortCode: 'D106052SG',
  organizationCode: 'DEMO',
  username: 'demo.worker',
  workerNo: 'W001',
  defaultSecret: 'worker1234',
  defaultPin: '123456',
} as const;

export async function seedDevelopmentData(prisma: PrismaClient): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development seed is disabled when NODE_ENV=production');
  }

  const secret = process.env.DEV_SEED_SECRET ?? DEV_SEED.defaultSecret;
  const pin = process.env.DEV_SEED_PIN ?? DEV_SEED.defaultPin;
  const preserveCredentials = process.env.DEV_SEED_PRESERVE_CREDENTIALS === 'true';
  if (secret.length < 8 || pin.length < 4) {
    throw new Error('DEV_SEED_SECRET must contain at least 8 characters and DEV_SEED_PIN at least 4');
  }
  const [passwordHash, pinHash] = await Promise.all([hashSecret(secret), hashSecret(pin)]);

  await prisma.organization.upsert({
    where: { code: DEV_SEED.organizationCode },
    update: { name: 'MES 演示组织', status: 'ACTIVE' },
    create: {
      id: DEV_SEED.organizationId,
      code: DEV_SEED.organizationCode,
      name: 'MES 演示组织',
      status: 'ACTIVE',
    },
  });
  await prisma.factory.upsert({
    where: {
      organizationId_code: {
        organizationId: DEV_SEED.organizationId,
        code: 'SG-DEMO',
      },
    },
    update: { name: '新加坡演示工厂', timezone: 'Asia/Singapore', status: 'ACTIVE' },
    create: {
      id: DEV_SEED.factoryId,
      organizationId: DEV_SEED.organizationId,
      code: 'SG-DEMO',
      name: '新加坡演示工厂',
      timezone: 'Asia/Singapore',
      status: 'ACTIVE',
    },
  });
  await prisma.appUser.upsert({
    where: {
      organizationId_username: {
        organizationId: DEV_SEED.organizationId,
        username: DEV_SEED.username,
      },
    },
    update: {
      ...(preserveCredentials ? {} : { passwordHash }),
      displayName: '演示工人',
      status: 'ACTIVE',
      deletedAt: null,
    },
    create: {
      id: DEV_SEED.userId,
      organizationId: DEV_SEED.organizationId,
      username: DEV_SEED.username,
      passwordHash,
      displayName: '演示工人',
      status: 'ACTIVE',
    },
  });
  await prisma.role.upsert({
    where: {
      organizationId_code: {
        organizationId: DEV_SEED.organizationId,
        code: 'DEMO_OPERATOR',
      },
    },
    update: { name: '演示操作员', permissions: ['*'], dataScope: 'FACTORY' },
    create: {
      id: DEV_SEED.roleId,
      organizationId: DEV_SEED.organizationId,
      code: 'DEMO_OPERATOR',
      name: '演示操作员',
      permissions: ['*'],
      dataScope: 'FACTORY',
    },
  });
  await prisma.userRole.upsert({
    where: { id: DEV_SEED.userRoleId },
    update: { userId: DEV_SEED.userId, roleId: DEV_SEED.roleId, factoryId: DEV_SEED.factoryId },
    create: {
      id: DEV_SEED.userRoleId,
      userId: DEV_SEED.userId,
      roleId: DEV_SEED.roleId,
      factoryId: DEV_SEED.factoryId,
    },
  });
  await prisma.worker.upsert({
    where: { userId: DEV_SEED.userId },
    update: {
      factoryId: DEV_SEED.factoryId,
      workerNo: DEV_SEED.workerNo,
      name: '演示工人',
      ...(preserveCredentials ? {} : { pinHash }),
      status: 'ACTIVE',
      deletedAt: null,
    },
    create: {
      id: DEV_SEED.workerId,
      factoryId: DEV_SEED.factoryId,
      userId: DEV_SEED.userId,
      workerNo: DEV_SEED.workerNo,
      name: '演示工人',
      pinHash,
      status: 'ACTIVE',
    },
  });
  await prisma.customer.upsert({
    where: { factoryId_code: { factoryId: DEV_SEED.factoryId, code: 'DEMO-CUSTOMER' } },
    update: { name: '演示客户', status: 'ACTIVE', deletedAt: null },
    create: {
      id: DEV_SEED.customerId,
      factoryId: DEV_SEED.factoryId,
      code: 'DEMO-CUSTOMER',
      name: '演示客户',
    },
  });
  await prisma.style.upsert({
    where: { factoryId_code: { factoryId: DEV_SEED.factoryId, code: 'TSHIRT-001' } },
    update: {
      customerId: DEV_SEED.customerId,
      name: '基础圆领 T 恤',
      versionName: 'V1',
      status: 'ACTIVE',
      deletedAt: null,
    },
    create: {
      id: DEV_SEED.styleId,
      factoryId: DEV_SEED.factoryId,
      customerId: DEV_SEED.customerId,
      code: 'TSHIRT-001',
      customerStyleNo: 'DEMO-TS-001',
      name: '基础圆领 T 恤',
      versionName: 'V1',
    },
  });
  await prisma.color.upsert({
    where: { factoryId_code: { factoryId: DEV_SEED.factoryId, code: 'NAVY' } },
    update: { name: '藏青', status: 'ACTIVE' },
    create: {
      id: DEV_SEED.colorId,
      factoryId: DEV_SEED.factoryId,
      code: 'NAVY',
      name: '藏青',
    },
  });
  await prisma.size.upsert({
    where: { factoryId_code: { factoryId: DEV_SEED.factoryId, code: 'M' } },
    update: { name: 'M', status: 'ACTIVE' },
    create: {
      id: DEV_SEED.sizeId,
      factoryId: DEV_SEED.factoryId,
      code: 'M',
      name: 'M',
    },
  });
  await prisma.process.upsert({
    where: { factoryId_code: { factoryId: DEV_SEED.factoryId, code: 'SEW-001' } },
    update: { name: '合肩缝制', defaultPieceRate: '0.5000', status: 'ACTIVE' },
    create: {
      id: DEV_SEED.processId,
      factoryId: DEV_SEED.factoryId,
      code: 'SEW-001',
      name: '合肩缝制',
      defaultStandardSeconds: 45,
      defaultPieceRate: '0.5000',
    },
  });
  await prisma.routeVersion.upsert({
    where: { styleId_versionNo: { styleId: DEV_SEED.styleId, versionNo: 1 } },
    update: {},
    create: {
      id: DEV_SEED.routeVersionId,
      factoryId: DEV_SEED.factoryId,
      styleId: DEV_SEED.styleId,
      versionNo: 1,
      status: 'PUBLISHED',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date(),
      publishedBy: DEV_SEED.userId,
      createdBy: DEV_SEED.userId,
      updatedBy: DEV_SEED.userId,
    },
  });
  await prisma.routeStep.upsert({
    where: { routeVersionId_stepNo: { routeVersionId: DEV_SEED.routeVersionId, stepNo: 1 } },
    update: {
      processId: DEV_SEED.processId,
      isRequired: true,
      isFinal: true,
      standardSeconds: 45,
      pieceRate: '0.5000',
    },
    create: {
      id: DEV_SEED.routeStepId,
      factoryId: DEV_SEED.factoryId,
      routeVersionId: DEV_SEED.routeVersionId,
      stepNo: 1,
      processId: DEV_SEED.processId,
      isRequired: true,
      isFinal: true,
      standardSeconds: 45,
      pieceRate: '0.5000',
    },
  });
  await prisma.workerSkill.upsert({
    where: {
      workerId_processId_effectiveFrom: {
        workerId: DEV_SEED.workerId,
        processId: DEV_SEED.processId,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      },
    },
    update: { skillLevel: 3, effectiveTo: null },
    create: {
      workerId: DEV_SEED.workerId,
      processId: DEV_SEED.processId,
      skillLevel: 3,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  await prisma.productionOrder.upsert({
    where: { factoryId_orderNo: { factoryId: DEV_SEED.factoryId, orderNo: 'PO-260526' } },
    update: { status: 'IN_PROGRESS', totalPlannedQty: 40, updatedBy: DEV_SEED.userId },
    create: {
      id: DEV_SEED.orderId,
      factoryId: DEV_SEED.factoryId,
      orderNo: 'PO-260526',
      customerId: DEV_SEED.customerId,
      styleId: DEV_SEED.styleId,
      status: 'IN_PROGRESS',
      plannedStartDate: new Date('2026-08-29T00:00:00.000Z'),
      dueDate: new Date('2026-09-05T00:00:00.000Z'),
      totalPlannedQty: 40,
      createdBy: DEV_SEED.userId,
      updatedBy: DEV_SEED.userId,
    },
  });
  await prisma.productionOrderItem.upsert({
    where: { orderId_lineNo: { orderId: DEV_SEED.orderId, lineNo: 1 } },
    update: { plannedQty: 40 },
    create: {
      id: DEV_SEED.orderItemId,
      factoryId: DEV_SEED.factoryId,
      orderId: DEV_SEED.orderId,
      lineNo: 1,
      colorId: DEV_SEED.colorId,
      sizeId: DEV_SEED.sizeId,
      dyeLotNo: 'A03',
      plannedQty: 40,
    },
  });
  await prisma.cuttingBed.upsert({
    where: { factoryId_bedNo: { factoryId: DEV_SEED.factoryId, bedNo: '478' } },
    update: { plyCount: 40, status: 'CUTTING' },
    create: {
      id: DEV_SEED.cuttingBedId,
      factoryId: DEV_SEED.factoryId,
      orderId: DEV_SEED.orderId,
      bedNo: '478',
      cutDate: new Date('2026-08-29T00:00:00.000Z'),
      plyCount: 40,
      dyeLotNo: 'A03',
      status: 'CUTTING',
      supervisorWorkerId: DEV_SEED.workerId,
      createdBy: DEV_SEED.userId,
    },
  });
  await prisma.bundle.upsert({
    where: { factoryId_bundleNo: { factoryId: DEV_SEED.factoryId, bundleNo: DEV_SEED.bundleNo } },
    update: {},
    create: {
      id: DEV_SEED.bundleId,
      factoryId: DEV_SEED.factoryId,
      orderId: DEV_SEED.orderId,
      orderItemId: DEV_SEED.orderItemId,
      cuttingBedId: DEV_SEED.cuttingBedId,
      routeVersionId: DEV_SEED.routeVersionId,
      bundleNo: DEV_SEED.bundleNo,
      bundleSeq: 2,
      shortCode: DEV_SEED.bundleShortCode,
      qrTokenHash: createHash('sha256').update(DEV_SEED.bundleShortCode).digest('hex'),
      plannedQty: 4,
      effectiveQty: 4,
      currentStepNo: 1,
      createdBy: DEV_SEED.userId,
    },
  });
  await prisma.bundleRouteStep.upsert({
    where: { bundleId_stepNo: { bundleId: DEV_SEED.bundleId, stepNo: 1 } },
    update: {
      processId: DEV_SEED.processId,
      processCodeSnapshot: 'SEW-001',
      processNameSnapshot: '合肩缝制',
      pieceRateSnapshot: '0.5000',
    },
    create: {
      id: DEV_SEED.bundleRouteStepId,
      factoryId: DEV_SEED.factoryId,
      bundleId: DEV_SEED.bundleId,
      sourceRouteStepId: DEV_SEED.routeStepId,
      stepNo: 1,
      processId: DEV_SEED.processId,
      processCodeSnapshot: 'SEW-001',
      processNameSnapshot: '合肩缝制',
      isRequired: true,
      standardSeconds: 45,
      pieceRateSnapshot: '0.5000',
      status: 'READY',
    },
  });
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedDevelopmentData(prisma);
    console.log(JSON.stringify({
      seeded: true,
      organizationCode: DEV_SEED.organizationCode,
      factoryId: DEV_SEED.factoryId,
      account: DEV_SEED.workerNo,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
