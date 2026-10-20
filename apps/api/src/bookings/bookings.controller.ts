import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthContext, AuthedRequest } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { parseBody } from '../common/zod.js';
import {
  BookingListQuery,
  FulfilmentConfirmInput,
  FulfilmentInput,
  FulfilmentRequestInput,
  ManualBookingInput,
  OfflinePaymentInput,
  ReasonInput,
} from './booking.schemas.js';
import { BookingsService } from './bookings.service.js';

const REFERENCE = /^NAV-\d{6,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valid(value: string, re: RegExp, what: string) {
  if (!re.test(value)) throw new BadRequestException(`Invalid ${what}`);
  return value;
}

/** Operations console API for concierge bookings (FS §12, §12.1). */
@Controller('bookings')
export class BookingsController {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @Post('manual')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  create(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    return this.bookings.createManual(parseBody(ManualBookingInput, body), auth, req.correlationId);
  }

  @Get()
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE')
  list(@Query() query: unknown) {
    return this.bookings.list(parseBody(BookingListQuery, query));
  }

  @Get(':reference')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE')
  async get(@Param('reference') reference: string) {
    return this.bookings.detail(
      await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference')),
    );
  }

  /** D-19 step 1 — record an offline receipt. */
  @Post(':reference/payments/offline')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE')
  async recordOffline(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    return this.bookings.recordOfflinePayment(
      id,
      parseBody(OfflinePaymentInput, body),
      auth,
      req.correlationId,
    );
  }

  @Post(':reference/payments/waive')
  @Roles('OPS_MANAGER')
  async waive(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    return this.bookings.waiveBalance(
      id,
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
  }

  /** Add a supplier item, e.g. a replacement hotel after a decline (EC-08). */
  @Post(':reference/fulfilments')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  async addComponent(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    return this.bookings.addComponent(
      id,
      parseBody(FulfilmentInput, body),
      auth,
      req.correlationId,
    );
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  /** D-19 step 2 — a different Finance / Ops Manager user confirms the money arrived. */
  @Post(':id/confirm')
  @HttpCode(200)
  @Roles('FINANCE', 'OPS_MANAGER')
  confirm(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    return this.bookings.confirmOfflinePayment(
      valid(id, UUID, 'payment id'),
      auth,
      req.correlationId,
    );
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('FINANCE', 'OPS_MANAGER')
  reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.bookings.rejectOfflinePayment(
      valid(id, UUID, 'payment id'),
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
  }
}

/** FS §32: POST /fulfilments/{id}/confirm, plus request and decline. */
@Controller('fulfilments')
@Roles('OPS_COORDINATOR', 'OPS_MANAGER')
export class FulfilmentsController {
  constructor(@Inject(BookingsService) private readonly bookings: BookingsService) {}

  @Post(':id/request')
  @HttpCode(200)
  request(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.bookings.requestComponent(
      valid(id, UUID, 'fulfilment id'),
      parseBody(FulfilmentRequestInput, body ?? {}),
      auth,
      req.correlationId,
    );
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.bookings.confirmComponent(
      valid(id, UUID, 'fulfilment id'),
      parseBody(FulfilmentConfirmInput, body),
      auth,
      req.correlationId,
    );
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.bookings.declineComponent(
      valid(id, UUID, 'fulfilment id'),
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
  }
}
