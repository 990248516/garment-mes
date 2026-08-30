import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { normalizeWorkerCreate, normalizeWorkerPatch } from './workers.service';

const userId = '11111111-1111-4111-8111-111111111111';
const processId = '22222222-2222-4222-8222-222222222222';
const secondProcessId = '33333333-3333-4333-8333-333333333333';
const workshopId = '44444444-4444-4444-8444-444444444444';
const lineId = '55555555-5555-4555-8555-555555555555';

test('worker creation normalizes account, placement, PIN and multiple initial skills', () => {
  const input = normalizeWorkerCreate({
    workerNo: ' W002 ',
    name: ' 李明 ',
    userId,
    pin: '4826',
    workshopId,
    productionLineId: lineId,
    hiredOn: '2026-08-01',
    skills: [
      { processId, level: 2 },
      { processId: secondProcessId, level: 4, effectiveFrom: '2026-08-15' },
    ],
  }, new Date('2026-08-29T12:00:00.000Z'));

  assert.equal(input.workerNo, 'W002');
  assert.equal(input.name, '李明');
  assert.equal(input.pin, '4826');
  assert.equal(input.status, 'ACTIVE');
  assert.equal(input.skills.length, 2);
  assert.equal(input.skills[0]?.effectiveFrom.toISOString().slice(0, 10), '2026-08-29');
});

test('worker creation rejects short PINs and duplicate skill periods', () => {
  assert.throws(() => normalizeWorkerCreate({ workerNo: 'W002', name: '李明', pin: '123' }), BadRequestException);
  assert.throws(() => normalizeWorkerCreate({
    workerNo: 'W002',
    name: '李明',
    skills: [
      { processId, level: 2, effectiveFrom: '2026-08-01' },
      { processId, level: 3, effectiveFrom: '2026-08-01' },
    ],
  }), BadRequestException);
});

test('worker patch preserves explicit unlink, PIN clear and LEFT status', () => {
  const patch = normalizeWorkerPatch({
    userId: null,
    pin: null,
    workshopId: null,
    productionLineId: null,
    status: 'LEFT',
    leftOn: '2026-08-29',
  });
  assert.equal(patch.userId, null);
  assert.equal(patch.pin, null);
  assert.equal(patch.workshopId, null);
  assert.equal(patch.productionLineId, null);
  assert.equal(patch.status, 'LEFT');
  assert.equal(patch.leftOn?.toISOString().slice(0, 10), '2026-08-29');
});

test('worker patch rejects empty or inapplicable bodies', () => {
  assert.throws(() => normalizeWorkerPatch({}), BadRequestException);
  assert.throws(() => normalizeWorkerPatch({ workerNo: 'IMMUTABLE' }), BadRequestException);
});
