import { strict as assert } from 'node:assert';
import test from 'node:test';

import { createHealthSnapshot } from './health';

test('createHealthSnapshot returns deterministic operational metadata', () => {
  const snapshot = createHealthSnapshot(new Date('2026-08-29T12:00:00.000Z'), 12.9);

  assert.deepEqual(snapshot, {
    status: 'ok',
    service: 'garment-mes-api',
    timestamp: '2026-08-29T12:00:00.000Z',
    uptimeSeconds: 12,
  });
});

test('createHealthSnapshot never exposes negative uptime', () => {
  assert.equal(createHealthSnapshot(new Date(0), -1).uptimeSeconds, 0);
});
