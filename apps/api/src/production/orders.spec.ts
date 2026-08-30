import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

import { normalizeOrderPatch } from './orders.service';

const styleId = '11111111-1111-4111-8111-111111111111';
const colorId = '22222222-2222-4222-8222-222222222222';
const sizeId = '33333333-3333-4333-8333-333333333333';

test('order patch normalizes editable draft fields and replacement lines', () => {
  const patch = normalizeOrderPatch({
    customerId: null,
    styleId,
    dueDate: '2026-09-10',
    notes: ' 更新备注 ',
    items: [{ lineNo: 1, colorId, sizeId, plannedQty: 20, overproductionLimit: 2 }],
  });
  assert.equal(patch.styleId, styleId);
  assert.equal(patch.customerId, null);
  assert.equal(patch.dueDate?.toISOString().slice(0, 10), '2026-09-10');
  assert.equal(patch.notes, '更新备注');
  assert.equal(patch.items?.[0]?.plannedQty, 20);
});

test('order patch rejects empty bodies and duplicate line numbers', () => {
  assert.throws(() => normalizeOrderPatch({}), BadRequestException);
  assert.throws(() => normalizeOrderPatch({ items: [
    { lineNo: 1, colorId, sizeId, plannedQty: 10 },
    { lineNo: 1, colorId, sizeId, plannedQty: 12 },
  ] }), UnprocessableEntityException);
});
