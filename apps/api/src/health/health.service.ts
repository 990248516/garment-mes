import { Injectable } from '@nestjs/common';

import { createHealthSnapshot, type HealthSnapshot } from './health';

@Injectable()
export class HealthService {
  getHealth(): HealthSnapshot {
    return createHealthSnapshot();
  }
}
