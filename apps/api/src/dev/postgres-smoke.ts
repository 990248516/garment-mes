import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../app.module';
import { DEV_SEED, seedDevelopmentData } from './seed';

interface LoginResponse {
  accessToken: string;
}
interface MasterDataItemResponse {
  id: string;
  code: string;
  name: string;
  version: number;
  defaultPieceRate: string | null;
}
interface MasterDataPageResponse {
  items: MasterDataItemResponse[];
  page: { total: number };
}
interface WorkerSkillResponse {
  id: string;
  processId: string;
  level: number;
}
interface WorkerResponse {
  id: string;
  userId: string | null;
  workerNo: string;
  name: string;
  workshopId: string | null;
  productionLineId: string | null;
  status: string;
  version: number;
  skills: WorkerSkillResponse[];
}
interface WorkerPageResponse {
  items: WorkerResponse[];
  page: { total: number };
}
interface WorkshopResponse {
  id: string;
  code: string;
  name: string;
  managerWorkerId: string | null;
  status: string;
  version: number;
}
interface ProductionLineResponse extends WorkshopResponse {
  workshopId: string;
}
interface OrganizationPageResponse<T> {
  items: T[];
  page: { total: number };
}
interface RouteVersionResponse {
  id: string;
  versionNo: number;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  effectiveFrom: string | null;
  steps: Array<{
    stepNo: number;
    processId: string;
    isFinal: boolean;
    pieceRate: string | null;
    minimumSkillLevel: number;
  }>;
}
interface RouteVersionPageResponse {
  items: RouteVersionResponse[];
  page: { total: number };
}
interface OrderResponse {
  id: string;
  status: string;
  items: Array<{ id: string }>;
}
interface CuttingBedResponse {
  id: string;
}
interface GenerateResponse {
  bundleCount: number;
  bundles: Array<{ id: string; shortCode: string }>;
}
interface ResolveResponse {
  eligibleOperations: Array<{ bundleRouteStepId: string }>;
}
interface StartResponse {
  workReport: { id: string; status: string };
}
interface CompleteResponse {
  bundle: { status: string; completedQty: number };
  qualityIssues: Array<{ quantity: number }>;
  pieceworkEntry: { amount: string; quantity: number } | null;
}
interface PieceworkResponse {
  estimatedAmount: string;
  goodQty: number;
  defectQty: number;
  items: Array<{ workReportId: string; amount: string }>;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('PostgreSQL smoke test is disabled when NODE_ENV=production');
  }
  const prisma = new PrismaClient();
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await seedDevelopmentData(prisma);
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    const baseUrl = await app.getUrl();
    const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`.toUpperCase();

    const login = await request<LoginResponse>(baseUrl, '/api/v1/auth/login', 200, {
      method: 'POST',
      body: {
        account: DEV_SEED.workerNo,
        secret: process.env.DEV_SEED_PIN ?? DEV_SEED.defaultPin,
        organizationCode: DEV_SEED.organizationCode,
        deviceId: 'postgres-smoke',
      },
    });
    assert.ok(login.accessToken);

    const authorized = {
      authorization: `Bearer ${login.accessToken}`,
      'x-factory-id': DEV_SEED.factoryId,
    };

    const smokeUser = await prisma.appUser.create({
      data: {
        organizationId: DEV_SEED.organizationId,
        username: `worker-${suffix}`.slice(0, 80),
        displayName: '烟雾测试员工账号',
      },
    });
    const smokeWorkshop = await request<WorkshopResponse>(baseUrl, '/api/v1/workshops', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        code: `WS-${suffix}`.slice(0, 40),
        name: '烟雾测试车间',
        managerWorkerId: DEV_SEED.workerId,
      },
    });
    assert.equal(smokeWorkshop.status, 'ACTIVE');
    assert.equal(smokeWorkshop.version, 1);
    assert.equal(smokeWorkshop.managerWorkerId, DEV_SEED.workerId);

    const workshopPage = await request<OrganizationPageResponse<WorkshopResponse>>(
      baseUrl,
      `/api/v1/workshops?q=${encodeURIComponent(smokeWorkshop.code)}&status=ACTIVE`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.deepEqual(workshopPage.items.map((workshop) => workshop.id), [smokeWorkshop.id]);

    const smokeLine = await request<ProductionLineResponse>(baseUrl, '/api/v1/production-lines', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        workshopId: smokeWorkshop.id,
        code: `LN-${suffix}`.slice(0, 40),
        name: '烟雾测试产线',
        managerWorkerId: DEV_SEED.workerId,
      },
    });
    assert.equal(smokeLine.workshopId, smokeWorkshop.id);
    assert.equal(smokeLine.managerWorkerId, DEV_SEED.workerId);

    const linePage = await request<OrganizationPageResponse<ProductionLineResponse>>(
      baseUrl,
      `/api/v1/production-lines?workshopId=${smokeWorkshop.id}&status=ACTIVE`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.deepEqual(linePage.items.map((line) => line.id), [smokeLine.id]);

    const smokeWorker = await request<WorkerResponse>(baseUrl, '/api/v1/workers', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        workerNo: `W-${suffix}`.slice(0, 40),
        name: '烟雾测试员工',
        userId: smokeUser.id,
        pin: '7391',
        productionLineId: smokeLine.id,
        hiredOn: '2026-08-01',
        skills: [{ processId: DEV_SEED.processId, level: 2, effectiveFrom: '2026-08-01' }],
      },
    });
    assert.equal(smokeWorker.version, 1);
    assert.equal(smokeWorker.userId, smokeUser.id);
    assert.equal(smokeWorker.workshopId, smokeWorkshop.id);
    assert.equal(smokeWorker.productionLineId, smokeLine.id);
    assert.equal(smokeWorker.skills.length, 1);
    assert.ok(!('pin' in smokeWorker) && !('pinHash' in smokeWorker));

    const workerDetail = await request<WorkerResponse>(
      baseUrl,
      `/api/v1/workers/${smokeWorker.id}`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.equal(workerDetail.skills[0]?.processId, DEV_SEED.processId);

    const updatedWorker = await request<WorkerResponse>(
      baseUrl,
      `/api/v1/workers/${smokeWorker.id}`,
      200,
      {
        method: 'PATCH',
        headers: {
          ...authorized,
          'idempotency-key': randomUUID(),
          'if-match': `"${smokeWorker.version}"`,
        },
        body: { name: '烟雾测试员工（已更新）', userId: null, pin: null, status: 'INACTIVE' },
      },
    );
    assert.equal(updatedWorker.version, 2);
    assert.equal(updatedWorker.userId, null);
    assert.equal(updatedWorker.status, 'INACTIVE');

    const workerPage = await request<WorkerPageResponse>(
      baseUrl,
      `/api/v1/workers?q=${encodeURIComponent(updatedWorker.name)}&status=INACTIVE&processId=${DEV_SEED.processId}`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.deepEqual(workerPage.items.map((worker) => worker.id), [smokeWorker.id]);

    const smokeProcess = await request<MasterDataItemResponse>(baseUrl, '/api/v1/master-data/processes', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        code: `SMK-${suffix}`.slice(0, 40),
        name: '烟雾测试工序',
        unit: 'PIECE',
        defaultStandardSeconds: 30,
        defaultPieceRate: '0.6500',
      },
    });
    assert.equal(smokeProcess.version, 1);
    assert.equal(smokeProcess.defaultPieceRate, '0.6500');

    const processPage = await request<MasterDataPageResponse>(
      baseUrl,
      `/api/v1/master-data/processes?q=${encodeURIComponent(smokeProcess.code)}`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.ok(processPage.items.some((item) => item.id === smokeProcess.id));

    const updatedProcess = await request<MasterDataItemResponse>(
      baseUrl,
      `/api/v1/master-data/processes/${smokeProcess.id}`,
      200,
      {
        method: 'PATCH',
        headers: {
          ...authorized,
          'idempotency-key': randomUUID(),
          'if-match': `"${smokeProcess.version}"`,
        },
        body: { name: '烟雾测试工序（已更新）', defaultPieceRate: '0.7000' },
      },
    );
    assert.equal(updatedProcess.version, 2);
    assert.equal(updatedProcess.defaultPieceRate, '0.7000');

    const replacedSkills = await request<WorkerSkillResponse[]>(
      baseUrl,
      `/api/v1/workers/${DEV_SEED.workerId}/skills`,
      200,
      {
        method: 'PUT',
        headers: { ...authorized, 'idempotency-key': randomUUID() },
        body: { skills: [
          { processId: DEV_SEED.processId, level: 3, effectiveFrom: '2026-01-01' },
          { processId: smokeProcess.id, level: 4, effectiveFrom: '2026-01-01' },
        ] },
      },
    );
    assert.equal(replacedSkills.length, 2);
    assert.ok(replacedSkills.every((skill) => skill.id && skill.level >= 1));
    const listedSkills = await request<WorkerSkillResponse[]>(
      baseUrl,
      `/api/v1/workers/${DEV_SEED.workerId}/skills`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.deepEqual(
      new Set(listedSkills.map((skill) => skill.processId)),
      new Set([DEV_SEED.processId, smokeProcess.id]),
    );

    const routeDraft = await request<RouteVersionResponse>(baseUrl, '/api/v1/route-versions', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        styleId: DEV_SEED.styleId,
        effectiveFrom: null,
        steps: [{
          stepNo: 1,
          processId: DEV_SEED.processId,
          isRequired: true,
          isQualityGate: false,
          allowParallel: false,
          isFinal: true,
          standardSeconds: 45,
          pieceRate: '0.5000',
          minimumSkillLevel: 2,
          allowedWorkshopIds: [],
          prerequisiteStepNos: [],
        }],
      },
    });
    assert.equal(routeDraft.status, 'DRAFT');
    assert.equal(routeDraft.versionNo, 2);
    assert.equal(routeDraft.version, 1);

    const replacedRoute = await request<RouteVersionResponse>(
      baseUrl,
      `/api/v1/route-versions/${routeDraft.id}`,
      200,
      {
        method: 'PUT',
        headers: {
          ...authorized,
          'idempotency-key': randomUUID(),
          'if-match': `"${routeDraft.version}"`,
        },
        body: {
          effectiveFrom: null,
          steps: [{
            stepNo: 1,
            processId: DEV_SEED.processId,
            isRequired: true,
            isQualityGate: true,
            allowParallel: false,
            canSkip: false,
            isFinal: true,
            standardSeconds: 45,
            pieceRate: null,
            allowedWorkshopIds: [],
            minimumSkillLevel: 3,
            prerequisiteStepNos: [],
          }],
        },
      },
    );
    assert.equal(replacedRoute.version, 2);
    assert.equal(replacedRoute.steps[0]?.pieceRate, null);
    assert.equal(replacedRoute.steps[0]?.minimumSkillLevel, 3);

    const routeDetail = await request<RouteVersionResponse>(
      baseUrl,
      `/api/v1/route-versions/${routeDraft.id}`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.equal(routeDetail.steps[0]?.isFinal, true);

    const publishedRoute = await request<RouteVersionResponse>(
      baseUrl,
      `/api/v1/route-versions/${routeDraft.id}:publish`,
      200,
      {
        method: 'POST',
        headers: { ...authorized, 'idempotency-key': randomUUID() },
        body: { effectiveFrom: isoDate(new Date()), reason: 'PostgreSQL route smoke test' },
      },
    );
    assert.equal(publishedRoute.status, 'PUBLISHED');
    assert.equal(publishedRoute.version, 3);

    const publishedRoutes = await request<RouteVersionPageResponse>(
      baseUrl,
      `/api/v1/route-versions?styleId=${DEV_SEED.styleId}&routeStatus=PUBLISHED`,
      200,
      { method: 'GET', headers: authorized },
    );
    assert.deepEqual(publishedRoutes.items.map((route) => route.id), [publishedRoute.id]);

    const clonedRoute = await request<RouteVersionResponse>(
      baseUrl,
      `/api/v1/route-versions/${publishedRoute.id}:clone`,
      201,
      { method: 'POST', headers: { ...authorized, 'idempotency-key': randomUUID() } },
    );
    assert.equal(clonedRoute.status, 'DRAFT');
    assert.equal(clonedRoute.versionNo, 3);
    assert.equal(clonedRoute.steps[0]?.isFinal, true);

    const order = await request<OrderResponse>(baseUrl, '/api/v1/orders', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        orderNo: `SMOKE-${suffix}`,
        customerId: DEV_SEED.customerId,
        styleId: DEV_SEED.styleId,
        plannedStartDate: isoDate(new Date()),
        dueDate: isoDate(new Date(Date.now() + 7 * 86_400_000)),
        items: [{
          lineNo: 1,
          colorId: DEV_SEED.colorId,
          sizeId: DEV_SEED.sizeId,
          plannedQty: 10,
          overproductionLimit: 0,
        }],
      },
    });
    assert.equal(order.status, 'DRAFT');
    assert.equal(order.items.length, 1);

    const released = await request<OrderResponse>(baseUrl, `/api/v1/orders/${order.id}:release`, 200, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: { reason: 'PostgreSQL smoke test' },
    });
    assert.equal(released.status, 'RELEASED');

    const bed = await request<CuttingBedResponse>(baseUrl, '/api/v1/cutting-beds', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        orderId: order.id,
        bedNo: `BED-${suffix}`,
        cutDate: isoDate(new Date()),
        plyCount: 10,
        supervisorWorkerId: DEV_SEED.workerId,
      },
    });

    const generated = await request<GenerateResponse>(baseUrl, `/api/v1/cutting-beds/${bed.id}/bundles:generate`, 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        routeVersionId: publishedRoute.id,
        bundleNoPrefix: `SMK-${suffix}`.slice(0, 40),
        lines: [{
          orderItemId: order.items[0]!.id,
          standardBundleQty: 10,
          quantityToAllocate: 10,
          allowTailBundle: true,
        }],
      },
    });
    assert.equal(generated.bundleCount, 1);
    const bundle = generated.bundles[0]!;

    const resolved = await request<ResolveResponse>(baseUrl, '/api/v1/bundles/resolve', 200, {
      method: 'POST',
      headers: authorized,
      body: { code: bundle.shortCode, deviceId: 'postgres-smoke' },
    });
    assert.equal(resolved.eligibleOperations.length, 1);

    const started = await request<StartResponse>(baseUrl, '/api/v1/work-reports:start', 201, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        bundleId: bundle.id,
        bundleRouteStepId: resolved.eligibleOperations[0]!.bundleRouteStepId,
        deviceId: 'postgres-smoke',
        workstationCode: 'SMOKE-WS-01',
      },
    });
    assert.equal(started.workReport.status, 'STARTED');

    const completed = await request<CompleteResponse>(baseUrl, `/api/v1/work-reports/${started.workReport.id}:complete`, 200, {
      method: 'POST',
      headers: { ...authorized, 'idempotency-key': randomUUID() },
      body: {
        inputQty: 10,
        goodQty: 9,
        defectQty: 1,
        missingQty: 0,
        deviceId: 'postgres-smoke',
        defects: [{ defectCode: 'STITCH-SKIP', quantity: 1, severity: 'MINOR' }],
      },
    });
    assert.equal(completed.bundle.status, 'COMPLETED');
    assert.equal(completed.bundle.completedQty, 9);
    assert.equal(completed.qualityIssues.length, 1);
    assert.equal(completed.pieceworkEntry?.amount, '4.5000');

    const piecework = await request<PieceworkResponse>(baseUrl, '/api/v1/me/piecework?period=TODAY', 200, {
      method: 'GET',
      headers: authorized,
    });
    assert.ok(piecework.items.some((item) => item.workReportId === started.workReport.id && item.amount === '4.5000'));
    assert.ok(Number(piecework.estimatedAmount) >= 4.5);
    assert.ok(piecework.goodQty >= 9);
    assert.ok(piecework.defectQty >= 1);

    const [storedOrder, storedReport, issueCount, storedPiecework, storedPublishedRoute, storedOldRoute, storedClone, storedSmokeWorker] = await Promise.all([
      prisma.productionOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.workReport.findUniqueOrThrow({ where: { id: started.workReport.id } }),
      prisma.qualityIssue.count({ where: { workReportId: started.workReport.id } }),
      prisma.pieceworkEntry.findFirstOrThrow({ where: { workReportId: started.workReport.id, adjustmentOfId: null } }),
      prisma.routeVersion.findUniqueOrThrow({ where: { id: publishedRoute.id } }),
      prisma.routeVersion.findUniqueOrThrow({ where: { id: DEV_SEED.routeVersionId } }),
      prisma.routeVersion.findUniqueOrThrow({ where: { id: clonedRoute.id } }),
      prisma.worker.findUniqueOrThrow({ where: { id: smokeWorker.id } }),
    ]);
    assert.equal(storedOrder.status, 'COMPLETED');
    assert.equal(storedReport.inputQty, storedReport.goodQty + storedReport.defectQty + storedReport.missingQty);
    assert.equal(issueCount, 1);
    assert.equal(storedPiecework.amount.toFixed(4), '4.5000');
    assert.equal(storedPublishedRoute.status, 'PUBLISHED');
    assert.equal(storedOldRoute.status, 'RETIRED');
    assert.equal(storedClone.status, 'DRAFT');
    assert.equal(storedSmokeWorker.version, 2);
    assert.equal(storedSmokeWorker.status, 'INACTIVE');
    assert.equal(storedSmokeWorker.userId, null);
    assert.equal(storedSmokeWorker.pinHash, null);
    assert.equal(storedSmokeWorker.workshopId, smokeWorkshop.id);
    assert.equal(storedSmokeWorker.productionLineId, smokeLine.id);

    console.log(JSON.stringify({
      smoke: 'PASS',
      worker: {
        id: storedSmokeWorker.id,
        status: storedSmokeWorker.status,
        version: storedSmokeWorker.version,
        skillCount: smokeWorker.skills.length,
        accountUnlinked: storedSmokeWorker.userId === null,
        pinCleared: storedSmokeWorker.pinHash === null,
      },
      routeVersion: {
        publishedId: storedPublishedRoute.id,
        publishedVersionNo: storedPublishedRoute.versionNo,
        oldStatus: storedOldRoute.status,
        cloneStatus: storedClone.status,
      },
      orderId: order.id,
      bundleId: bundle.id,
      workReportId: started.workReport.id,
      orderStatus: storedOrder.status,
      quantity: { input: 10, good: 9, defect: 1, missing: 0 },
      pieceworkAmount: storedPiecework.amount.toFixed(4),
      qualityIssueCount: issueCount,
    }));
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  expectedStatus: number,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT';
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: {
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const payload = text === '' ? null : safeJson(text);
  if (response.status !== expectedStatus) {
    throw new Error(`${options.method} ${path} returned ${response.status}; expected ${expectedStatus}: ${text}`);
  }
  return payload as T;
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
