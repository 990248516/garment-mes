import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { TokenService } from './token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (Array.isArray(authorization) || typeof authorization !== 'string') {
      throw new UnauthorizedException('Bearer token is required');
    }
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (!match?.[1]) throw new UnauthorizedException('Bearer token is required');

    const claims = this.tokens.verifyAccessToken(match[1]);
    const identity = await this.authService.authenticate(claims);
    request.auth = { claims, ...identity };
    return true;
  }
}
