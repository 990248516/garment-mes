import {
  BadRequestException,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import type { AuthenticatedRequest, CurrentUser } from '../auth/auth.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireFactoryId(value: string | string[] | undefined, user: CurrentUser): string {
  if (Array.isArray(value) || typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new BadRequestException('X-Factory-Id must be a valid UUID');
  }
  if (!user.factories.some((factory) => factory.factoryId === value)) {
    throw new ForbiddenException('Factory is outside the current user data scope');
  }
  return value;
}

@Injectable()
export class FactoryContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new UnauthorizedException();
    request.factoryId = requireFactoryId(request.headers['x-factory-id'], request.auth.user);
    return true;
  }
}
