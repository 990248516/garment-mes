import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { AuthService, type LoginInput } from './auth.service';
import type { AuthenticatedRequest, CurrentUser } from './auth.types';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/login')
  @HttpCode(200)
  login(@Body() body: LoginInput): Promise<Record<string, unknown>> {
    return this.authService.login(body);
  }

  @Post('auth/refresh')
  refresh(@Body() body: { refreshToken?: unknown }): Promise<Record<string, unknown>> {
    return this.authService.refresh(body?.refreshToken);
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.authService.logout(request.auth!.claims);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest): CurrentUser {
    return request.auth!.user;
  }
}
