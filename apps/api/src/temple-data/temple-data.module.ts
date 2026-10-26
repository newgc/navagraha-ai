import { Module } from '@nestjs/common';
import { FactChecksService } from './fact-checks.service.js';
import { TempleDataController } from './temple-data.controller.js';
import { TempleDataService } from './temple-data.service.js';

@Module({
  controllers: [TempleDataController],
  providers: [TempleDataService, FactChecksService],
  exports: [FactChecksService],
})
export class TempleDataModule {}
