import { Module } from '@nestjs/common';
import { PlannerController } from './planner.controller.js';
import { PlannerService } from './planner.service.js';
import { TempleDataModule } from '../temple-data/temple-data.module.js';

@Module({
  imports: [TempleDataModule],
  controllers: [PlannerController],
  providers: [PlannerService],
  exports: [PlannerService],
})
export class PlannerModule {}
