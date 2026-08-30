import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  normalizeProductionLineCreate,
  normalizeWorkshopCreate,
} from './organization-resources.service';

const workshopId = '11111111-1111-4111-8111-111111111111';
const managerWorkerId = '22222222-2222-4222-8222-222222222222';

test('workshop creation normalizes code, name, manager and default status', () => {
  const input = normalizeWorkshopCreate({
    code: ' WS-01 ',
    name: ' 一车间 ',
    managerWorkerId,
  });
  assert.equal(input.code, 'WS-01');
  assert.equal(input.name, '一车间');
  assert.equal(input.managerWorkerId, managerWorkerId);
  assert.equal(input.status, 'ACTIVE');
});

test('production line creation requires a workshop and accepts inactive status', () => {
  const input = normalizeProductionLineCreate({
    workshopId,
    code: 'LINE-01',
    name: '一号线',
    status: 'INACTIVE',
  });
  assert.equal(input.workshopId, workshopId);
  assert.equal(input.status, 'INACTIVE');
  assert.throws(
    () => normalizeProductionLineCreate({ code: 'LINE-02', name: '二号线' }),
    BadRequestException,
  );
});

test('organization resources reject invalid status and manager UUID', () => {
  assert.throws(
    () => normalizeWorkshopCreate({ code: 'WS-02', name: '二车间', status: 'LEFT' }),
    BadRequestException,
  );
  assert.throws(
    () => normalizeWorkshopCreate({ code: 'WS-02', name: '二车间', managerWorkerId: 'not-a-uuid' }),
    BadRequestException,
  );
});
