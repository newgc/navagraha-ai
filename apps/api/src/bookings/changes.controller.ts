import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { AuthContext, AuthedRequest } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { parseBody } from '../common/zod.js';
import {
  AcceptInput,
  CancellationReviewInput,
  ChangeProposalInput,
  ReasonInput,
} from './booking.schemas.js';
import { BookingsService } from './bookings.service.js';
import { CancellationsService } from './cancellations.service.js';
import { GatewayRefundsService } from './gateway-refunds.service.js';
import { ChangesService } from './changes.service.js';
import { UUID, valid } from './ids.js';

/** Every action answers with the updated booking, like the booking routes. */
@Controller('change-requests')
@Roles('OPS_COORDINATOR', 'OPS_MANAGER')
export class ChangeRequestsController {
  constructor(
    @Inject(ChangesService) private readonly changes: ChangesService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  @Post(':id/proposal')
  @HttpCode(200)
  async propose(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.changes.propose(
      valid(id, UUID, 'change request id'),
      parseBody(ChangeProposalInput, body),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }

  /** The customer accepted the proposal and any price difference. */
  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.changes.approve(
      valid(id, UUID, 'change request id'),
      parseBody(AcceptInput, body).acceptedVia,
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.changes.reject(
      valid(id, UUID, 'change request id'),
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  async withdraw(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.changes.withdraw(
      valid(id, UUID, 'change request id'),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }
}

@Controller('cancellations')
export class CancellationsController {
  constructor(
    @Inject(CancellationsService) private readonly cancellations: CancellationsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  /** The coordinator proposes the refund (D-06 is open, so a person decides). */
  @Post(':id/review')
  @HttpCode(200)
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  async review(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.cancellations.review(
      valid(id, UUID, 'cancellation id'),
      parseBody(CancellationReviewInput, body),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('OPS_MANAGER')
  async approve(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.cancellations.approve(
      valid(id, UUID, 'cancellation id'),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('OPS_MANAGER')
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.cancellations.reject(
      valid(id, UUID, 'cancellation id'),
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }
}

@Controller('refunds')
@Roles('FINANCE', 'OPS_MANAGER')
export class RefundsController {
  constructor(
    @Inject(CancellationsService) private readonly cancellations: CancellationsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(GatewayRefundsService) private readonly gatewayRefunds: GatewayRefundsService,
  ) {}

  /** D-11 — a different Finance / manager user approves a gateway refund; it is then sent. */
  @Post(':id/approve')
  @HttpCode(200)
  async approve(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const refundId = valid(id, UUID, 'refund id');
    await this.gatewayRefunds.approve(refundId, auth, req.correlationId);
    return this.bookings.detail(await this.gatewayRefunds.bookingOf(refundId));
  }

  /** Sends an approved gateway refund again after the gateway could not be reached. */
  @Post(':id/send')
  @HttpCode(200)
  async send(@Param('id') id: string, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    const refundId = valid(id, UUID, 'refund id');
    await this.gatewayRefunds.send(refundId, auth.userId, req.correlationId);
    return this.bookings.detail(await this.gatewayRefunds.bookingOf(refundId));
  }

  /** MR-19 — read the refund from the gateway now. */
  @Post(':id/check')
  @HttpCode(200)
  async check(@Param('id') id: string, @Req() req: AuthedRequest) {
    const refundId = valid(id, UUID, 'refund id');
    await this.gatewayRefunds.reconcile(refundId, req.correlationId);
    return this.bookings.detail(await this.gatewayRefunds.bookingOf(refundId));
  }

  /** D-19 extension step 2 — a different Finance / manager user confirms the refund. */
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.cancellations.confirmRefund(
      valid(id, UUID, 'refund id'),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }

  @Post(':id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const bookingId = await this.cancellations.rejectRefund(
      valid(id, UUID, 'refund id'),
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
    return this.bookings.detail(bookingId);
  }
}
