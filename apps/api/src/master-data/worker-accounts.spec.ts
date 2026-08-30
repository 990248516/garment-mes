import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  normalizeAccountStatus,
  normalizePasswordReset,
  normalizeWorkerAccountCreate,
} from './worker-accounts.service';

const workerId = '11111111-1111-4111-8111-111111111111';

test('worker account creation accepts only explicit worker binding and password input', () => {
  const input = normalizeWorkerAccountCreate({
    workerId,
    username: ' operator.w002 ',
    displayName: ' 李明 ',
    password: 'Temporary-123',
    roleId: 'ignored-by-design',
  });
  assert.deepEqual(input, {
    workerId,
    username: 'operator.w002',
    displayName: '李明',
    password: 'Temporary-123',
  });
  assert.ok(!('roleId' in input));
});

test('worker account validation rejects weak passwords and privileged statuses', () => {
  assert.throws(() => normalizePasswordReset({ password: 'short' }), BadRequestException);
  assert.throws(() => normalizeAccountStatus({ status: 'LOCKED' }), BadRequestException);
  assert.equal(normalizeAccountStatus({ status: 'INACTIVE' }), 'INACTIVE');
});
