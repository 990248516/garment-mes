import { Prisma } from '@prisma/client';

export const workReportInclude = Prisma.validator<Prisma.WorkReportInclude>()({
  bundle: true,
  bundleRouteStep: { include: { process: true } },
  worker: true,
});
export type WorkReportRecord = Prisma.WorkReportGetPayload<{ include: typeof workReportInclude }>;

export const pieceworkInclude = Prisma.validator<Prisma.PieceworkEntryInclude>()({
  workReport: { include: { bundle: true, bundleRouteStep: true } },
  worker: true,
  process: true,
});
export type PieceworkRecord = Prisma.PieceworkEntryGetPayload<{ include: typeof pieceworkInclude }>;

export function serializeWorkReport(report: WorkReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    factoryId: report.factoryId,
    requestId: report.requestId,
    bundleId: report.bundleId,
    bundleNo: report.bundle.bundleNo,
    bundleRouteStepId: report.bundleRouteStepId,
    processId: report.bundleRouteStep.processId,
    processCode: report.bundleRouteStep.processCodeSnapshot,
    processName: report.bundleRouteStep.processNameSnapshot,
    workerId: report.workerId,
    workerName: report.worker.name,
    workshopId: report.workshopId,
    productionLineId: report.productionLineId,
    status: report.status,
    inputQty: report.inputQty,
    goodQty: report.goodQty,
    defectQty: report.defectQty,
    missingQty: report.missingQty,
    startedAt: report.startedAt.toISOString(),
    completedAt: report.completedAt?.toISOString() ?? null,
    clientStartedAt: report.clientStartedAt?.toISOString() ?? null,
    clientCompletedAt: report.clientCompletedAt?.toISOString() ?? null,
    deviceId: report.deviceId,
    unitRateSnapshot: money(report.unitRateSnapshot),
    estimatedAmount: money(report.unitRateSnapshot.mul(report.bundle.effectiveQty)),
    notes: report.notes,
    correctionOfId: report.correctionOfId,
    createdAt: report.createdAt.toISOString(),
  };
}

export function serializeBundleStep(step: {
  id: string;
  bundleId: string;
  sourceRouteStepId: string | null;
  stepNo: number;
  processId: string;
  processCodeSnapshot: string;
  processNameSnapshot: string;
  isRequired: boolean;
  isQualityGate: boolean;
  isRework: boolean;
  reworkOfStepId: string | null;
  standardSeconds: number | null;
  pieceRateSnapshot: Prisma.Decimal;
  inputQty: number;
  goodQty: number;
  defectQty: number;
  missingQty: number;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  version: number;
}): Record<string, unknown> {
  return {
    id: step.id,
    bundleId: step.bundleId,
    sourceRouteStepId: step.sourceRouteStepId,
    stepNo: step.stepNo,
    processId: step.processId,
    processCode: step.processCodeSnapshot,
    processName: step.processNameSnapshot,
    isRequired: step.isRequired,
    isQualityGate: step.isQualityGate,
    isRework: step.isRework,
    reworkOfStepId: step.reworkOfStepId,
    standardSeconds: step.standardSeconds,
    pieceRateSnapshot: money(step.pieceRateSnapshot),
    inputQty: step.inputQty,
    goodQty: step.goodQty,
    defectQty: step.defectQty,
    missingQty: step.missingQty,
    status: step.status,
    startedAt: step.startedAt?.toISOString() ?? null,
    completedAt: step.completedAt?.toISOString() ?? null,
    version: step.version,
  };
}

export function serializePiecework(entry: PieceworkRecord): Record<string, unknown> {
  return {
    id: entry.id,
    factoryId: entry.factoryId,
    workReportId: entry.workReportId,
    workerId: entry.workerId,
    workerNo: entry.worker.workerNo,
    workerName: entry.worker.name,
    bundleId: entry.workReport.bundleId,
    bundleNo: entry.workReport.bundle.bundleNo,
    processId: entry.processId,
    processName: entry.process.name,
    quantity: entry.quantity,
    unitRate: money(entry.unitRate),
    amount: money(entry.amount),
    status: entry.status,
    isRework: entry.workReport.bundleRouteStep.isRework,
    adjustmentOfId: entry.adjustmentOfId,
    reason: entry.reason,
    occurredAt: entry.createdAt.toISOString(),
    confirmedAt: null,
    settledAt: null,
  };
}

export function money(value: Prisma.Decimal): string {
  return value.toFixed(4);
}
