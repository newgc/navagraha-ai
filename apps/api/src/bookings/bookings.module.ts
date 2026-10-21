import { Module } from '@nestjs/common';
import { TransitionService } from '../state/transition.service.js';
import {
  BookingsController,
  FulfilmentsController,
  PaymentsController,
  PaymentWebhooksController,
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
import { PaymentLinksService } from './payment-links.service.js';
import { gatewayProvider } from '../payments/gateway.js';

@Module({
  controllers: [
    BookingsController,
    PaymentsController,
    PaymentWebhooksController,
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
    PaymentLinksService,
    gatewayProvider,
  ],
})
export class BookingsModule {}
