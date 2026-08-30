import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

import {
  normalizeRouteCreate,
  normalizeRouteReplace,
  normalizeRouteSteps,
  validatePublishableSteps,
} from './route-versions.service';

const styleId = '11111111-1111-4111-8111-111111111111';
const processId = '22222222-2222-4222-8222-222222222222';
const secondProcessId = '33333333-3333-4333-8333-333333333333';
const workshopId = '44444444-4444-4444-8444-444444444444';

function routeStep(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stepNo: 1,
    processId,
    isRequired: true,
    isQualityGate: false,
    allowParallel: false,
    ...overrides,
  };
}

test('route draft creation accepts an empty initial step collection', () => {
  const input = normalizeRouteCreate({ styleId, effectiveFrom: null });
  assert.equal(input.styleId, styleId);
  assert.equal(input.effectiveFrom, null);
  assert.deepEqual(input.steps, []);
});

test('route steps normalize full process, workshop, skill and price configuration', () => {
  const steps = normalizeRouteSteps([
    routeStep({
      canSkip: true,
      isFinal: false,
      standardSeconds: 45,
      pieceRate: '0.6500',
      allowedWorkshopIds: [workshopId],
      minimumSkillLevel: 3,
    }),
    routeStep({
      stepNo: 2,
      processId: secondProcessId,
      allowParallel: true,
      isFinal: true,
      prerequisiteStepNos: [1],
    }),
  ]);

  assert.equal(steps[0]?.pieceRate?.toFixed(4), '0.6500');
  assert.deepEqual(steps[0]?.allowedWorkshopIds, [workshopId]);
  assert.equal(steps[0]?.minimumSkillLevel, 3);
  assert.deepEqual(steps[1]?.prerequisiteStepNos, [1]);
  assert.equal(steps[1]?.isFinal, true);
});

test('route replacement rejects missing, non-contiguous and forward-dependent steps', () => {
  assert.throws(() => normalizeRouteReplace({}), BadRequestException);
  assert.throws(
    () => normalizeRouteSteps([routeStep(), routeStep({ stepNo: 3, processId: secondProcessId })]),
    UnprocessableEntityException,
  );
  assert.throws(
    () => normalizeRouteSteps([routeStep({ prerequisiteStepNos: [1] })]),
    UnprocessableEntityException,
  );
});

test('publishing requires exactly one final step', () => {
  assert.doesNotThrow(() => validatePublishableSteps([{ isFinal: false }, { isFinal: true }]));
  assert.throws(() => validatePublishableSteps([{ isFinal: false }]), UnprocessableEntityException);
  assert.throws(
    () => validatePublishableSteps([{ isFinal: true }, { isFinal: true }]),
    UnprocessableEntityException,
  );
});
