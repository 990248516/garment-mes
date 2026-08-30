import { strict as assert } from 'node:assert';
import test from 'node:test';

import { Prisma } from '@prisma/client';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { planBundles } from './bundle-planner';
import { BundlesService, enrichBundleEventPayload } from './bundles.service';
import { hashRequest } from './idempotency.service';
import { decodeCursor, encodeCursor } from './validation';
import { validateQuantityConservation } from './work-reports.service';

const orderItemId = '11111111-1111-4111-8111-111111111111';

test('bundle planner conserves quantity and creates an explicit tail bundle', () => {
  const plans = planBundles([{
    orderItemId,
    plannedQty: 23,
    allocatedQty: 0,
    overproductionLimit: 0,
    standardBundleQty: 10,
    quantityToAllocate: null,
    allowTailBundle: true,
    authorizedOverproductionQty: 0,
    overproductionReason: null,
  }], 4);
  assert.deepEqual(plans, [
    { orderItemId, bundleSeq: 4, plannedQty: 10, isTail: false },
    { orderItemId, bundleSeq: 5, plannedQty: 10, isTail: false },
    { orderItemId, bundleSeq: 6, plannedQty: 3, isTail: true },
  ]);
  assert.equal(plans.reduce((total, plan) => total + plan.plannedQty, 0), 23);
});

test('bundle planner appends bundles for the remaining quantity after an earlier release', () => {
  const plans = planBundles([{
    orderItemId,
    plannedQty: 40,
    allocatedQty: 36,
    overproductionLimit: 0,
    standardBundleQty: 4,
    quantityToAllocate: null,
    allowTailBundle: true,
    authorizedOverproductionQty: 0,
    overproductionReason: null,
  }], 10);
  assert.deepEqual(plans, [
    { orderItemId, bundleSeq: 10, plannedQty: 4, isTail: false },
  ]);
});

test('bundle planner rejects unapproved overproduction and forbidden tails', () => {
  const base = {
    orderItemId,
    plannedQty: 20,
    allocatedQty: 0,
    overproductionLimit: 2,
    standardBundleQty: 10,
    quantityToAllocate: 21,
    allowTailBundle: true,
    authorizedOverproductionQty: 0,
    overproductionReason: null,
  };
  assert.throws(() => planBundles([base]), BadRequestException);
  assert.throws(
    () => planBundles([{ ...base, quantityToAllocate: 19, allowTailBundle: false }]),
    BadRequestException,
  );
  assert.throws(
    () => planBundles([{ ...base, authorizedOverproductionQty: 1 }]),
    BadRequestException,
  );
});

test('idempotency hash is stable across object key order and changes with payload', () => {
  assert.equal(hashRequest({ b: 2, a: 1 }), hashRequest({ a: 1, b: 2 }));
  assert.notEqual(hashRequest({ a: 1 }), hashRequest({ a: 2 }));
});

test('opaque cursors round-trip UUIDs and reject malformed input', () => {
  const cursor = encodeCursor(orderItemId);
  assert.equal(decodeCursor(cursor), orderItemId);
  assert.throws(() => decodeCursor('not-a-cursor'), BadRequestException);
});

test('work completion enforces input = good + defect + missing', () => {
  assert.doesNotThrow(() => validateQuantityConservation({
    inputQty: 10,
    goodQty: 8,
    defectQty: 1,
    missingQty: 1,
  }));
  assert.throws(() => validateQuantityConservation({
    inputQty: 10,
    goodQty: 8,
    defectQty: 1,
    missingQty: 0,
  }));
});


test('bundle timeline enriches historical work events with process snapshot names', () => {
  const payload = enrichBundleEventPayload(
    { bundleRouteStepId: 'step-1', goodQty: 8 },
    new Map([['step-1', { processCode: 'SEW-001', processName: '合肩缝制' }]]),
  );
  assert.deepEqual(payload, {
    bundleRouteStepId: 'step-1',
    goodQty: 8,
    processCode: 'SEW-001',
    processName: '合肩缝制',
  });
});


test('completed bundle work details identify the employee, process, quantities, and amount', async () => {
  const service = new BundlesService({
    bundle: {
      findFirst: async () => ({
        id: 'bundle-1',
        bundleNo: 'B-001',
        status: 'COMPLETED',
        effectiveQty: 10,
        completedQty: 10,
        cuttingBed: { bedNo: 'BED-01' },
        order: { orderNo: 'PO-001', style: { code: 'STYLE-01', name: '长裤' } },
        orderItem: {
          dyeLotNo: 'LOT-01',
          color: { code: 'BLUE', name: '蓝色' },
          size: { code: 'XL', name: '加大码' },
        },
        routeVersion: { versionNo: 2 },
        routeSteps: [{
          stepNo: 1,
          processCodeSnapshot: 'SEW-001',
          processNameSnapshot: '合肩缝制',
          status: 'COMPLETED',
          startedAt: new Date('2026-08-30T01:00:00Z'),
          completedAt: new Date('2026-08-30T01:10:00Z'),
          inputQty: 10,
          goodQty: 10,
          defectQty: 0,
          missingQty: 0,
          pieceRateSnapshot: new Prisma.Decimal('0.8000'),
          workReports: [{
            status: 'COMPLETED',
            startedAt: new Date('2026-08-30T01:00:00Z'),
            completedAt: new Date('2026-08-30T01:10:00Z'),
            inputQty: 10,
            goodQty: 10,
            defectQty: 0,
            missingQty: 0,
            unitRateSnapshot: new Prisma.Decimal('0.8000'),
            notes: '正常完成',
            worker: { workerNo: 'W001', name: '员工甲' },
            pieceworkEntries: [{ amount: new Prisma.Decimal('8.0000') }],
          }],
        }],
      }),
    },
  } as never, {} as never);

  const result = await service.workDetails('factory-1', '11111111-1111-4111-8111-111111111111');
  assert.deepEqual((result.rows as Array<Record<string, unknown>>)[0], {
    stepNo: 1,
    processCode: 'SEW-001',
    processName: '合肩缝制',
    workerNo: 'W001',
    workerName: '员工甲',
    status: 'COMPLETED',
    startedAt: '2026-08-30T01:00:00.000Z',
    completedAt: '2026-08-30T01:10:00.000Z',
    inputQty: 10,
    goodQty: 10,
    defectQty: 0,
    missingQty: 0,
    unitRate: '0.8000',
    amount: '8.0000',
    notes: '正常完成',
  });
});

test('order work-detail export waits until every active bundle is completed', async () => {
  let allCompleted = false;
  const bundleRecord = (bundleNo: string, status: string) => ({
    id: `bundle-${bundleNo}`,
    bundleNo,
    status,
    effectiveQty: 10,
    completedQty: status === 'COMPLETED' ? 10 : 0,
    cuttingBed: { bedNo: 'BED-01' },
    order: { orderNo: 'PO-001', style: { code: 'STYLE-01', name: '长裤' } },
    orderItem: {
      dyeLotNo: 'LOT-01',
      color: { code: 'BLUE', name: '蓝色' },
      size: { code: 'L', name: '大码' },
    },
    routeVersion: { versionNo: 2 },
    routeSteps: [],
  });
  const service = new BundlesService({
    productionOrder: {
      findFirst: async () => ({
        id: 'order-1',
        orderNo: 'PO-001',
        status: 'IN_PROGRESS',
        style: { code: 'STYLE-01', name: '长裤' },
        bundles: [
          bundleRecord('B-001', 'COMPLETED'),
          bundleRecord('B-002', allCompleted ? 'COMPLETED' : 'IN_PROGRESS'),
        ],
      }),
    },
  } as never, {} as never);

  await assert.rejects(
    () => service.orderWorkDetails('factory-1', '11111111-1111-4111-8111-111111111111'),
    ConflictException,
  );
  allCompleted = true;
  const result = await service.orderWorkDetails('factory-1', '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(result.order, {
    id: 'order-1',
    orderNo: 'PO-001',
    status: 'IN_PROGRESS',
    styleCode: 'STYLE-01',
    styleName: '长裤',
    bundleCount: 2,
    completedBundleCount: 2,
    totalEffectiveQty: 20,
    totalCompletedQty: 20,
  });
  assert.deepEqual(
    (result.bundles as Array<{ bundle: { bundleNo: string } }>).map((item) => item.bundle.bundleNo),
    ['B-001', 'B-002'],
  );
});
