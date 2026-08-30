import { Controller, Get } from '@nestjs/common';

import type { HealthSnapshot } from './health';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthSnapshot {
    return this.healthService.getHealth();
  }
}
