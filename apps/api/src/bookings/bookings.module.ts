import { Module } from '@nestjs/common';
import { TransitionService } from '../state/transition.service.js';
import {
  BookingsController,
  FulfilmentsController,
  PaymentsController,
} from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({
  controllers: [BookingsController, PaymentsController, FulfilmentsController],
  providers: [BookingsService, TransitionService],
})
export class BookingsModule {}
