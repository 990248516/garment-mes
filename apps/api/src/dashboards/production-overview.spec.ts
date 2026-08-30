import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { resolveDate } from './production-overview.service';

test('overview date defaults to the factory local calendar date', () => {
  assert.equal(
    resolveDate(undefined, 'Asia/Shanghai', new Date('2026-08-29T17:00:00.000Z')),
    '2026-08-30',
  );
  assert.equal(resolveDate('2026-08-29', 'Asia/Shanghai', new Date(0)), '2026-08-29');
});

test('overview date rejects impossible calendar dates', () => {
  assert.throws(
    () => resolveDate('2026-02-30', 'Asia/Shanghai', new Date(0)),
    BadRequestException,
  );
});
