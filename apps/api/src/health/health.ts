export interface HealthSnapshot {
  status: 'ok';
  service: 'garment-mes-api';
  timestamp: string;
  uptimeSeconds: number;
}

export function createHealthSnapshot(
  now: Date = new Date(),
  uptimeSeconds: number = process.uptime(),
): HealthSnapshot {
  return {
    status: 'ok',
    service: 'garment-mes-api',
    timestamp: now.toISOString(),
    uptimeSeconds: Math.max(0, Math.floor(uptimeSeconds)),
  };
}
