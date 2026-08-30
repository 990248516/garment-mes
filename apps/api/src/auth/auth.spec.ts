import { strict as assert } from 'node:assert';
import test from 'node:test';

import { UnauthorizedException } from '@nestjs/common';

import { hashSecret, verifySecret } from './password';
import { TokenService } from './token.service';

test('scrypt credentials verify without storing plaintext', async () => {
  const encoded = await hashSecret('4826');
  assert.match(encoded, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(await verifySecret('4826', encoded), true);
  assert.equal(await verifySecret('wrong', encoded), false);
  assert.equal(await verifySecret('4826', 'invalid'), false);
});

test('access tokens are signed, typed, expiring and tamper evident', () => {
  process.env.AUTH_TOKEN_SECRET = 'test-only-secret-with-at-least-32-characters';
  const tokens = new TokenService();
  const now = new Date('2026-08-29T12:00:00.000Z');
  const token = tokens.signAccessToken({
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
  }, now);

  assert.deepEqual(tokens.verifyAccessToken(token, now), {
    sub: '11111111-1111-4111-8111-111111111111',
    sid: '22222222-2222-4222-8222-222222222222',
    org: '33333333-3333-4333-8333-333333333333',
    typ: 'access',
    iat: 1788004800,
    exp: 1788005700,
  });
  assert.throws(() => tokens.verifyAccessToken(`${token}x`, now), UnauthorizedException);
  assert.throws(
    () => tokens.verifyAccessToken(token, new Date('2026-08-29T12:15:00.000Z')),
    UnauthorizedException,
  );
});
