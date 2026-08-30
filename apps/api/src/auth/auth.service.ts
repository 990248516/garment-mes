import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenClaims, CurrentUser, FactoryScope } from './auth.types';
import { verifySecret } from './password';
import { TokenService } from './token.service';

const REFRESH_TOKEN_DAYS = 30;
const userContextInclude = Prisma.validator<Prisma.AppUserInclude>()({
  organization: true,
  worker: true,
  roleAssignments: { include: { role: true, factory: true } },
});
type UserWithContext = Prisma.AppUserGetPayload<{ include: typeof userContextInclude }>;

export interface LoginInput {
  account?: unknown;
  secret?: unknown;
  organizationCode?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
}

export interface AuthIdentity {
  user: CurrentUser;
  factoryPermissions: Record<string, string[]>;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async login(input: LoginInput): Promise<Record<string, unknown>> {
    const account = requiredString(input.account, 'account', 80);
    const secret = requiredString(input.secret, 'secret', 200, 4);
    const organizationCode = optionalString(input.organizationCode, 'organizationCode', 40);
    const deviceId = optionalString(input.deviceId, 'deviceId', 100);
    const deviceName = optionalString(input.deviceName, 'deviceName', 100);

    const candidates = await this.prisma.appUser.findMany({
      where: {
        deletedAt: null,
        organization: {
          status: 'ACTIVE',
          ...(organizationCode ? { code: organizationCode } : {}),
        },
        OR: [
          { username: account },
          { worker: { is: { workerNo: account, status: 'ACTIVE', deletedAt: null } } },
        ],
      },
      include: userContextInclude,
      take: 2,
    });

    if (candidates.length !== 1) throw new UnauthorizedException('Invalid account or secret');
    const user = candidates[0] as UserWithContext;
    if (user.status !== 'ACTIVE') {
      throw new HttpException('Account is locked or inactive', HttpStatus.LOCKED);
    }

    const usesWorkerPin = user.worker?.workerNo === account;
    const encodedSecret = usesWorkerPin ? user.worker?.pinHash ?? user.passwordHash : user.passwordHash;
    if (!(await verifySecret(secret, encodedSecret))) {
      throw new UnauthorizedException('Invalid account or secret');
    }

    const refreshToken = randomBytes(32).toString('base64url');
    const now = new Date();
    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: hashRefreshToken(refreshToken),
        deviceId,
        deviceName,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_DAYS * 86_400_000),
      },
    });
    await this.prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    return this.sessionResponse(await this.buildIdentity(user), session.id, refreshToken, now);
  }

  async refresh(refreshTokenValue: unknown): Promise<Record<string, unknown>> {
    const refreshToken = requiredString(refreshTokenValue, 'refreshToken', 500, 20);
    const now = new Date();
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: hashRefreshToken(refreshToken) },
      include: { user: { include: userContextInclude } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.status !== 'ACTIVE' ||
      session.user.deletedAt
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const rotatedToken = randomBytes(32).toString('base64url');
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashRefreshToken(rotatedToken),
        lastUsedAt: now,
      },
    });
    return this.sessionResponse(
      await this.buildIdentity(session.user as UserWithContext),
      session.id,
      rotatedToken,
      now,
    );
  }

  async authenticate(claims: AccessTokenClaims): Promise<AuthIdentity> {
    const now = new Date();
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE', deletedAt: null, organizationId: claims.org },
      },
      include: { user: { include: userContextInclude } },
    });
    if (!session) throw new UnauthorizedException('Session is no longer active');
    return this.buildIdentity(session.user as UserWithContext);
  }

  async logout(claims: AccessTokenClaims): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: claims.sid, userId: claims.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async buildIdentity(user: UserWithContext): Promise<AuthIdentity> {
    const assignments = user.roleAssignments.filter(
      (assignment) => assignment.role.organizationId === user.organizationId,
    );
    const organizationWide = assignments.some((assignment) => assignment.factoryId === null);
    const factoryIds = [...new Set(assignments.flatMap((assignment) => assignment.factoryId ?? []))];
    const factories = organizationWide || factoryIds.length > 0
      ? await this.prisma.factory.findMany({
          where: {
            organizationId: user.organizationId,
            status: 'ACTIVE',
            ...(organizationWide ? {} : { id: { in: factoryIds } }),
          },
          orderBy: { name: 'asc' },
        })
      : [];

    const factoryPermissions: Record<string, string[]> = {};
    const factoryScopes: FactoryScope[] = factories.map((factory) => {
      const applicable = assignments.filter(
        (assignment) => assignment.factoryId === null || assignment.factoryId === factory.id,
      );
      factoryPermissions[factory.id] = unique(applicable.flatMap((assignment) => permissionsOf(assignment.role.permissions)));
      const dataScopes = unique(applicable.map((assignment) => assignment.role.dataScope))
        .filter(isDataScope);
      const workerAtFactory = user.worker?.factoryId === factory.id ? user.worker : null;
      return {
        factoryId: factory.id,
        factoryName: factory.name,
        dataScopes,
        workshopIds: workerAtFactory?.workshopId ? [workerAtFactory.workshopId] : [],
        productionLineIds: workerAtFactory?.productionLineId ? [workerAtFactory.productionLineId] : [],
      };
    });

    return {
      user: {
        id: user.id,
        organizationId: user.organizationId,
        username: user.username,
        displayName: user.displayName,
        workerId: user.worker?.id ?? null,
        roles: unique(assignments.map((assignment) => assignment.role.code)),
        permissions: unique(Object.values(factoryPermissions).flat()),
        factories: factoryScopes,
      },
      factoryPermissions,
    };
  }

  private sessionResponse(identity: AuthIdentity, sessionId: string, refreshToken: string, now: Date): Record<string, unknown> {
    return {
      accessToken: this.tokens.signAccessToken({
        userId: identity.user.id,
        sessionId,
        organizationId: identity.user.organizationId,
      }, now),
      refreshToken,
      expiresIn: this.tokens.expiresIn,
      tokenType: 'Bearer',
      user: identity.user,
      serverTime: now.toISOString(),
    };
  }
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function requiredString(value: unknown, name: string, maxLength: number, minLength = 1): string {
  if (typeof value !== 'string') throw new BadRequestException(`${name} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < minLength || trimmed.length > maxLength) {
    throw new BadRequestException(`${name} must contain ${minLength}-${maxLength} characters`);
  }
  return trimmed;
}

function optionalString(value: unknown, name: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, name, maxLength);
}

function permissionsOf(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function isDataScope(value: string): value is FactoryScope['dataScopes'][number] {
  return ['ALL', 'FACTORY', 'WORKSHOP', 'LINE', 'SELF'].includes(value);
}
