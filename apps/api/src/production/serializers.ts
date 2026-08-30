import { Prisma } from '@prisma/client';

import { isoDate } from './validation';

export const orderInclude = Prisma.validator<Prisma.ProductionOrderInclude>()({
  customer: true,
  style: true,
  items: {
    orderBy: { lineNo: 'asc' },
    include: {
      color: true,
      size: true,
      bundles: { select: { effectiveQty: true, completedQty: true, status: true } },
    },
  },
});
export type OrderRecord = Prisma.ProductionOrderGetPayload<{ include: typeof orderInclude }>;

export const cuttingBedInclude = Prisma.validator<Prisma.CuttingBedInclude>()({
  order: { select: { orderNo: true } },
  bundles: { select: { effectiveQty: true, status: true } },
});
export type CuttingBedRecord = Prisma.CuttingBedGetPayload<{ include: typeof cuttingBedInclude }>;

export const bundleInclude = Prisma.validator<Prisma.BundleInclude>()({
  order: { include: { style: true } },
  orderItem: { include: { color: true, size: true } },
  cuttingBed: true,
  routeSteps: { orderBy: { stepNo: 'asc' }, include: { process: true } },
});
export type BundleRecord = Prisma.BundleGetPayload<{ include: typeof bundleInclude }>;

export function serializeOrder(order: OrderRecord): Record<string, unknown> {
  const items = order.items.map((item) => {
    const activeBundles = item.bundles.filter((bundle) => bundle.status !== 'CANCELLED');
    return {
      id: item.id,
      orderId: item.orderId,
      lineNo: item.lineNo,
      colorId: item.colorId,
      colorCode: item.color.code,
      colorName: item.color.name,
      sizeId: item.sizeId,
      sizeCode: item.size.code,
      sizeName: item.size.name,
      dyeLotNo: item.dyeLotNo,
      plannedQty: item.plannedQty,
      overproductionLimit: item.overproductionLimit,
      allocatedQty: sum(activeBundles.map((bundle) => bundle.effectiveQty)),
      completedQty: sum(activeBundles.map((bundle) => bundle.completedQty)),
    };
  });
  const allocatedQty = sum(items.map((item) => item.allocatedQty));
  const completedQty = sum(items.map((item) => item.completedQty));
  return {
    id: order.id,
    factoryId: order.factoryId,
    orderNo: order.orderNo,
    customerId: order.customerId,
    customerName: order.customer?.name ?? null,
    styleId: order.styleId,
    styleCode: order.style.code,
    styleName: order.style.name ?? order.style.code,
    status: order.status,
    plannedStartDate: isoDate(order.plannedStartDate),
    dueDate: isoDate(order.dueDate),
    totalPlannedQty: order.totalPlannedQty,
    allocatedQty,
    completedQty,
    progressPercent: percentage(completedQty, order.totalPlannedQty),
    externalRef: order.externalRef,
    notes: order.notes,
    items,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    createdBy: order.createdBy,
    updatedBy: order.updatedBy,
    version: order.version,
  };
}

export function serializeCuttingBed(bed: CuttingBedRecord): Record<string, unknown> {
  const bundles = bed.bundles.filter((bundle) => bundle.status !== 'CANCELLED');
  return {
    id: bed.id,
    factoryId: bed.factoryId,
    orderId: bed.orderId,
    orderNo: bed.order.orderNo,
    bedNo: bed.bedNo,
    cutDate: isoDate(bed.cutDate),
    plyCount: bed.plyCount,
    dyeLotNo: bed.dyeLotNo,
    status: bed.status,
    supervisorWorkerId: bed.supervisorWorkerId,
    bundleCount: bundles.length,
    totalBundleQty: sum(bundles.map((bundle) => bundle.effectiveQty)),
    notes: bed.notes,
    createdAt: bed.createdAt.toISOString(),
    updatedAt: bed.updatedAt.toISOString(),
    createdBy: bed.createdBy,
  };
}

export function serializeBundle(bundle: BundleRecord): Record<string, unknown> {
  const currentStep = bundle.routeSteps.find((step) => step.stepNo === bundle.currentStepNo);
  return {
    id: bundle.id,
    factoryId: bundle.factoryId,
    orderId: bundle.orderId,
    orderNo: bundle.order.orderNo,
    orderItemId: bundle.orderItemId,
    cuttingBedId: bundle.cuttingBedId,
    bedNo: bundle.cuttingBed.bedNo,
    routeVersionId: bundle.routeVersionId,
    bundleNo: bundle.bundleNo,
    bundleSeq: bundle.bundleSeq,
    shortCode: bundle.shortCode,
    styleCode: bundle.order.style.code,
    styleName: bundle.order.style.name ?? bundle.order.style.code,
    colorCode: bundle.orderItem.color.code,
    colorName: bundle.orderItem.color.name,
    sizeCode: bundle.orderItem.size.code,
    sizeName: bundle.orderItem.size.name,
    dyeLotNo: bundle.orderItem.dyeLotNo ?? bundle.cuttingBed.dyeLotNo,
    plannedQty: bundle.plannedQty,
    effectiveQty: bundle.effectiveQty,
    completedQty: bundle.completedQty,
    status: bundle.status,
    currentStepNo: bundle.currentStepNo,
    currentProcessName: currentStep?.processNameSnapshot ?? null,
    currentWorkerName: null,
    currentWorkshopId: bundle.currentWorkshopId,
    currentProductionLineId: bundle.currentLineId,
    blockedReason: bundle.blockedReason,
    printedCount: bundle.printedCount,
    progressPercent: percentage(bundle.completedQty, bundle.effectiveQty),
    createdAt: bundle.createdAt.toISOString(),
    updatedAt: bundle.updatedAt.toISOString(),
    createdBy: bundle.createdBy,
    version: bundle.version,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percentage(value: number, total: number): string {
  return total === 0 ? '0.00' : ((value / total) * 100).toFixed(2);
}
