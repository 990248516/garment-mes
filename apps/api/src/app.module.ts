import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { HealthModule } from './health/health.module';
import { MasterDataModule } from './master-data/master-data.module';
import { RouteVersionsModule } from './master-data/route-versions.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductionModule } from './production/production.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    MasterDataModule,
    RouteVersionsModule,
    DashboardsModule,
    ProductionModule,
  ],
})
export class AppModule {}
