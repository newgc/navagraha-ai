import { Module } from '@nestjs/common';
import { PlannerController } from './planner.controller.js';
import { PlannerService } from './planner.service.js';

@Module({
  controllers: [PlannerController],
  providers: [PlannerService],
  exports: [PlannerService],
})
export class PlannerModule {}
