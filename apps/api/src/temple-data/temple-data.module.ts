import { Module } from '@nestjs/common';
import { TempleDataController } from './temple-data.controller.js';
import { TempleDataService } from './temple-data.service.js';

@Module({ controllers: [TempleDataController], providers: [TempleDataService] })
export class TempleDataModule {}
