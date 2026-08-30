import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import {
  ifMatchVersion,
  masterResource,
  normalizeMasterCreate,
} from './master-data.service';
import { normalizeProcessRateAdjustment } from './process-pricing.service';
import { normalizeSkillReplacement } from './worker-skills.service';

const processId = '11111111-1111-4111-8111-111111111111';
const secondProcessId = '22222222-2222-4222-8222-222222222222';

test('master resources reject unknown tables and accept contract resources', () => {
  assert.equal(masterResource('customers'), 'customers');
  assert.equal(masterResource('processes'), 'processes');
  assert.throws(() => masterResource('app_users'), BadRequestException);
});

test('If-Match requires a quoted positive integer version', () => {
  assert.equal(ifMatchVersion('"3"'), 3);
  assert.throws(() => ifMatchVersion('3'), BadRequestException);
  assert.throws(() => ifMatchVersion('"0"'), BadRequestException);
});

test('master create normalizes process rate and style metadata', () => {
  const process = normalizeMasterCreate('processes', {
    code: 'SEW-002',
    name: '上袖',
    unit: 'PIECE',
    defaultStandardSeconds: 30,
    defaultPieceRate: '0.6500',
  });
  assert.equal(process.defaultPieceRate?.toFixed(4), '0.6500');
  assert.equal(process.defaultStandardSeconds, 30);

  const style = normalizeMasterCreate('styles', {
    code: 'STYLE-2',
    name: '演示款式',
    imageUrl: 'https://example.test/style.png',
    versionName: 'V2',
  });
  assert.equal(style.imageUrl, 'https://example.test/style.png');
  assert.equal(style.versionName, 'V2');
});

test('skill replacement supports multiple processes and rejects duplicate periods', () => {
  const today = new Date('2026-08-29T12:00:00.000Z');
  const skills = normalizeSkillReplacement({ skills: [
    { processId, level: 3 },
    { processId: secondProcessId, level: 4, effectiveFrom: '2026-08-01', effectiveTo: '2026-12-31' },
  ] }, today);
  assert.equal(skills.length, 2);
  assert.equal(skills[0]?.effectiveFrom.toISOString().slice(0, 10), '2026-08-29');
  assert.throws(() => normalizeSkillReplacement({ skills: [
    { processId, level: 2, effectiveFrom: '2026-08-01' },
    { processId, level: 3, effectiveFrom: '2026-08-01' },
  ] }, today), BadRequestException);
});


test('process rate adjustment requires a reason for historical bundles', () => {
  const futureOnly = normalizeProcessRateAdjustment({
    expectedVersion: 2,
    unitRate: '0.7500',
    applyToHistoricalBundles: false,
  });
  assert.equal(futureOnly.unitRate.toFixed(4), '0.7500');
  assert.equal(futureOnly.reason, null);
  assert.throws(() => normalizeProcessRateAdjustment({
    expectedVersion: 2,
    unitRate: '0.7500',
    applyToHistoricalBundles: true,
  }), BadRequestException);
  const historical = normalizeProcessRateAdjustment({
    expectedVersion: 2,
    unitRate: '0.7500',
    applyToHistoricalBundles: true,
    reason: '统一调整八月工价',
  });
  assert.equal(historical.reason, '统一调整八月工价');
});
