import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

interface OverviewQuery {
  date?: string | undefined;
  workshopId?: string | undefined;
  lineId?: string | undefined;
}

interface CountRow {
  active_orders: bigint;
  active_bundles: bigint;
  wip_qty: bigint;
  blocked_bundles: bigint;
}

interface DailyRow {
  completed_qty: bigint;
  piecework_amount: Prisma.Decimal | string | null;
}

interface ProcessRow {
  process_id: string;
  process_code: string;
  process_name: string;
  expected_qty: bigint;
  input_qty: bigint;
  good_qty: bigint;
  defect_qty: bigint;
  missing_qty: bigint;
  wip_qty: bigint;
}

interface WorkerProcessRow {
  worker_id: string;
  worker_no: string;
  worker_name: string;
  process_id: string;
  process_code: string;
  process_name: string;
  completed_bundles: bigint;
  active_tasks: bigint;
  good_qty: bigint;
  defect_qty: bigint;
  missing_qty: bigint;
  piecework_amount: Prisma.Decimal | string | null;
}

@Injectable()
export class ProductionOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(factoryId: string, query: OverviewQuery, now = new Date()): Promise<Record<string, unknown>> {
    const factory = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { timezone: true, status: true },
    });
    if (!factory || factory.status !== 'ACTIVE') throw new NotFoundException('Factory not found');

    const date = resolveDate(query.date, factory.timezone, now);
    const workshopId = optionalUuid(query.workshopId, 'workshopId');
    const lineId = optionalUuid(query.lineId, 'lineId');
    const bundleScope = Prisma.sql`
      ${workshopId ? Prisma.sql`AND b.current_workshop_id = CAST(${workshopId} AS uuid)` : Prisma.empty}
      ${lineId ? Prisma.sql`AND b.current_line_id = CAST(${lineId} AS uuid)` : Prisma.empty}
    `;
    const reportScope = Prisma.sql`
      ${workshopId ? Prisma.sql`AND wr.workshop_id = CAST(${workshopId} AS uuid)` : Prisma.empty}
      ${lineId ? Prisma.sql`AND wr.production_line_id = CAST(${lineId} AS uuid)` : Prisma.empty}
    `;

    const [counts, daily, processRows, workerRows] = await Promise.all([
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT
          (SELECT COUNT(*) FROM production_orders po
            WHERE po.factory_id = CAST(${factoryId} AS uuid)
              AND po.status IN ('RELEASED', 'IN_PROGRESS')) AS active_orders,
          COUNT(*) FILTER (WHERE b.status IN ('CREATED', 'IN_PROGRESS', 'BLOCKED')) AS active_bundles,
          COALESCE(SUM(GREATEST(b.effective_qty - b.completed_qty, 0))
            FILTER (WHERE b.status IN ('CREATED', 'IN_PROGRESS', 'BLOCKED')), 0) AS wip_qty,
          COUNT(*) FILTER (WHERE b.status = 'BLOCKED') AS blocked_bundles
        FROM bundles b
        WHERE b.factory_id = CAST(${factoryId} AS uuid)
          ${bundleScope}
      `),
      this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(wr.good_qty) FILTER (WHERE wr.status = 'COMPLETED'), 0) AS completed_qty,
          COALESCE(SUM(pe.amount), 0) AS piecework_amount
        FROM work_reports wr
        LEFT JOIN (
          SELECT work_report_id,
            SUM(amount) FILTER (WHERE status <> 'REVERSED') AS amount
          FROM piecework_entries
          GROUP BY work_report_id
        ) pe ON pe.work_report_id = wr.id
        WHERE wr.factory_id = CAST(${factoryId} AS uuid)
          AND wr.completed_at >= (CAST(${date} AS date)::timestamp AT TIME ZONE ${factory.timezone})
          AND wr.completed_at < ((CAST(${date} AS date) + 1)::timestamp AT TIME ZONE ${factory.timezone})
          ${reportScope}
      `),
      this.prisma.$queryRaw<ProcessRow[]>(Prisma.sql`
        SELECT
          brs.process_id,
          brs.process_code_snapshot AS process_code,
          brs.process_name_snapshot AS process_name,
          COALESCE(SUM(b.effective_qty), 0) AS expected_qty,
          COALESCE(SUM(brs.input_qty), 0) AS input_qty,
          COALESCE(SUM(brs.good_qty), 0) AS good_qty,
          COALESCE(SUM(brs.defect_qty), 0) AS defect_qty,
          COALESCE(SUM(brs.missing_qty), 0) AS missing_qty,
          GREATEST(COALESCE(SUM(brs.input_qty - brs.good_qty - brs.defect_qty - brs.missing_qty), 0), 0) AS wip_qty
        FROM bundle_route_steps brs
        JOIN bundles b ON b.id = brs.bundle_id
        WHERE brs.factory_id = CAST(${factoryId} AS uuid)
          AND b.status <> 'CANCELLED'
          ${bundleScope}
        GROUP BY brs.process_id, brs.process_code_snapshot, brs.process_name_snapshot
        ORDER BY MIN(brs.step_no), brs.process_code_snapshot
      `),
      this.prisma.$queryRaw<WorkerProcessRow[]>(Prisma.sql`
        SELECT
          wr.worker_id,
          w.worker_no,
          w.name AS worker_name,
          brs.process_id,
          brs.process_code_snapshot AS process_code,
          brs.process_name_snapshot AS process_name,
          COUNT(DISTINCT wr.bundle_id) FILTER (WHERE wr.status = 'COMPLETED') AS completed_bundles,
          COUNT(*) FILTER (WHERE wr.status = 'STARTED') AS active_tasks,
          COALESCE(SUM(wr.good_qty) FILTER (WHERE wr.status = 'COMPLETED'), 0) AS good_qty,
          COALESCE(SUM(wr.defect_qty) FILTER (WHERE wr.status = 'COMPLETED'), 0) AS defect_qty,
          COALESCE(SUM(wr.missing_qty) FILTER (WHERE wr.status = 'COMPLETED'), 0) AS missing_qty,
          COALESCE(SUM(pe.amount), 0) AS piecework_amount
        FROM work_reports wr
        JOIN workers w ON w.id = wr.worker_id
        JOIN bundle_route_steps brs ON brs.id = wr.bundle_route_step_id
        LEFT JOIN (
          SELECT work_report_id,
            SUM(amount) FILTER (WHERE status <> 'REVERSED') AS amount
          FROM piecework_entries
          GROUP BY work_report_id
        ) pe ON pe.work_report_id = wr.id
        WHERE wr.factory_id = CAST(${factoryId} AS uuid)
          AND (
            (wr.status = 'COMPLETED'
              AND wr.completed_at >= (CAST(${date} AS date)::timestamp AT TIME ZONE ${factory.timezone})
              AND wr.completed_at < ((CAST(${date} AS date) + 1)::timestamp AT TIME ZONE ${factory.timezone}))
            OR
            (wr.status = 'STARTED'
              AND wr.started_at < ((CAST(${date} AS date) + 1)::timestamp AT TIME ZONE ${factory.timezone}))
          )
          ${reportScope}
        GROUP BY wr.worker_id, w.worker_no, w.name,
          brs.process_id, brs.process_code_snapshot, brs.process_name_snapshot
        ORDER BY good_qty DESC, piecework_amount DESC, w.worker_no, brs.process_code_snapshot
      `),
    ]);

    const count = counts[0];
    const day = daily[0];
    return {
      date,
      activeOrders: toNumber(count?.active_orders),
      activeBundles: toNumber(count?.active_bundles),
      completedQty: toNumber(day?.completed_qty),
      wipQty: toNumber(count?.wip_qty),
      blockedBundles: toNumber(count?.blocked_bundles),
      todayPieceworkAmount: money(day?.piecework_amount),
      processMetrics: processRows.map((row) => {
        const expectedQty = toNumber(row.expected_qty);
        const goodQty = toNumber(row.good_qty);
        return {
          processId: row.process_id,
          processCode: row.process_code,
          processName: row.process_name,
          expectedQty,
          inputQty: toNumber(row.input_qty),
          goodQty,
          defectQty: toNumber(row.defect_qty),
          missingQty: toNumber(row.missing_qty),
          wipQty: toNumber(row.wip_qty),
          completionRate: expectedQty === 0 ? '0.00' : ((goodQty / expectedQty) * 100).toFixed(2),
        };
      }),
      workerMetrics: workerRows.map((row) => ({
        workerId: row.worker_id,
        workerNo: row.worker_no,
        workerName: row.worker_name,
        processId: row.process_id,
        processCode: row.process_code,
        processName: row.process_name,
        completedBundles: toNumber(row.completed_bundles),
        activeTasks: toNumber(row.active_tasks),
        goodQty: toNumber(row.good_qty),
        defectQty: toNumber(row.defect_qty),
        missingQty: toNumber(row.missing_qty),
        pieceworkAmount: money(row.piecework_amount),
      })),
      calculatedAt: now.toISOString(),
    };
  }
}

export function resolveDate(value: string | undefined, timezone: string, now: Date): string {
  if (value !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('date must use YYYY-MM-DD');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('date must be a real calendar date');
    }
    return value;
  }
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    throw new BadRequestException('Factory timezone is invalid');
  }
}

function optionalUuid(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(`${name} must be a valid UUID`);
  }
  return value;
}

function toNumber(value: bigint | number | null | undefined): number {
  return Number(value ?? 0);
}

function money(value: Prisma.Decimal | string | null | undefined): string {
  const raw = value?.toString() ?? '0';
  const [whole, fraction = ''] = raw.split('.');
  return `${whole}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}
