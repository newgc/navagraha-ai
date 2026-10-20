import { Module } from '@nestjs/common';
import { TransitionService } from '../state/transition.service.js';
import {
  BookingsController,
  FulfilmentsController,
  PaymentsController,
} from './bookings.controller.js';
import { BookingCore } from './booking-core.js';
import { BookingsService } from './bookings.service.js';
import { CancellationsService } from './cancellations.service.js';
import {
  CancellationsController,
  ChangeRequestsController,
  RefundsController,
} from './changes.controller.js';
import { ChangesService } from './changes.service.js';

@Module({
  controllers: [
    BookingsController,
    PaymentsController,
    FulfilmentsController,
    ChangeRequestsController,
    CancellationsController,
    RefundsController,
  ],
  providers: [
    BookingsService,
    BookingCore,
    ChangesService,
    CancellationsService,
    TransitionService,
  ],
})
export class BookingsModule {}
