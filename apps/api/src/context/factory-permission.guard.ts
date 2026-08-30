import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../auth/auth.types';

const PERMISSION_METADATA = 'garment-mes:permission';
export const RequirePermission = (permission: string): MethodDecorator =>
  SetMetadata(PERMISSION_METADATA, permission);

@Injectable()
export class FactoryPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<string>(PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth || !request.factoryId) throw new UnauthorizedException();
    const permissions = request.auth.factoryPermissions[request.factoryId] ?? [];
    if (!permissions.includes(permission) && !permissions.includes('*')) {
      throw new ForbiddenException(`Missing permission: ${permission}`);
    }
    return true;
  }
}
