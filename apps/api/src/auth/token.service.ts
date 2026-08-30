import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';

import type { AccessTokenClaims } from './auth.types';

const ACCESS_TOKEN_SECONDS = 15 * 60;
const encoder = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

@Injectable()
export class TokenService {
  private readonly secret: Buffer;

  constructor() {
    const configured = process.env.AUTH_TOKEN_SECRET;
    if (!configured || configured.length < 32) {
      throw new Error('AUTH_TOKEN_SECRET must contain at least 32 characters');
    }
    this.secret = Buffer.from(configured, 'utf8');
  }

  signAccessToken(input: { userId: string; sessionId: string; organizationId: string }, now = new Date()): string {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const header = encoder({ alg: 'HS256', typ: 'JWT' });
    const payload = encoder({
      sub: input.userId,
      sid: input.sessionId,
      org: input.organizationId,
      typ: 'access',
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_SECONDS,
    } satisfies AccessTokenClaims);
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${this.signature(unsigned)}`;
  }

  verifyAccessToken(token: string, now = new Date()): AccessTokenClaims {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid access token');

    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const unsigned = `${headerPart}.${payloadPart}`;
    const expected = Buffer.from(this.signature(unsigned), 'base64url');
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new UnauthorizedException('Invalid access token');
    }

    try {
      const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as Record<string, unknown>;
      const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Partial<AccessTokenClaims>;
      const nowSeconds = Math.floor(now.getTime() / 1000);
      if (
        header.alg !== 'HS256' ||
        header.typ !== 'JWT' ||
        claims.typ !== 'access' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        typeof claims.org !== 'string' ||
        typeof claims.iat !== 'number' ||
        typeof claims.exp !== 'number' ||
        claims.exp <= nowSeconds ||
        claims.iat > nowSeconds + 30
      ) {
        throw new Error('Invalid claims');
      }
      return claims as AccessTokenClaims;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  get expiresIn(): number {
    return ACCESS_TOKEN_SECONDS;
  }

  private signature(unsigned: string): string {
    return createHmac('sha256', this.secret).update(unsigned).digest('base64url');
  }
}
