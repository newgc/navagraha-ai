import { Module } from '@nestjs/common';
import { PlannerModule } from '../planner/planner.module.js';
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
import { GatewayRefundsService } from './gateway-refunds.service.js';
import { MyTripsController, TripRequestsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { PaymentLinksService } from './payment-links.service.js';
import { gatewayProvider } from '../payments/gateway.js';

@Module({
  imports: [PlannerModule],
  controllers: [
    BookingsController,
    PaymentsController,
    PaymentWebhooksController,
    FulfilmentsController,
    ChangeRequestsController,
    CancellationsController,
    RefundsController,
    TripRequestsController,
    MyTripsController,
  ],
  providers: [
    BookingsService,
    BookingCore,
    ChangesService,
    CancellationsService,
    TransitionService,
    PaymentLinksService,
    GatewayRefundsService,
    LeadsService,
    gatewayProvider,
  ],
})
export class BookingsModule {}
