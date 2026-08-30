import { strict as assert } from 'node:assert';
import test from 'node:test';

import { BadRequestException, ForbiddenException } from '@nestjs/common';

import type { CurrentUser } from '../auth/auth.types';
import { requireFactoryId } from './factory-context.guard';

const allowedFactory = '11111111-1111-4111-8111-111111111111';
const user: CurrentUser = {
  id: '22222222-2222-4222-8222-222222222222',
  organizationId: '33333333-3333-4333-8333-333333333333',
  username: 'supervisor',
  displayName: 'Supervisor',
  workerId: null,
  roles: ['SUPERVISOR'],
  permissions: ['dashboard:production'],
  factories: [{
    factoryId: allowedFactory,
    factoryName: 'Factory A',
    dataScopes: ['FACTORY'],
    workshopIds: [],
    productionLineIds: [],
  }],
};

test('factory context accepts only an authorized UUID', () => {
  assert.equal(requireFactoryId(allowedFactory, user), allowedFactory);
  assert.throws(() => requireFactoryId(undefined, user), BadRequestException);
  assert.throws(() => requireFactoryId('not-a-uuid', user), BadRequestException);
  assert.throws(
    () => requireFactoryId('44444444-4444-4444-8444-444444444444', user),
    ForbiddenException,
  );
});
