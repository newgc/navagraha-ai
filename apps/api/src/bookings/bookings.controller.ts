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
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthContext, AuthedRequest } from '../auth/auth.types.js';
import { CurrentAuth, Public, Roles } from '../auth/decorators.js';
import { GATEWAY_WEBHOOK_TYPE } from '../payments/gateway.js';
import { parseBody } from '../common/zod.js';
import {
  BookingListQuery,
  FulfilmentConfirmInput,
  FulfilmentInput,
  FulfilmentRequestInput,
  GatewayRefundInput,
  CancellationInput,
  ChangeRequestInput,
  ManualBookingInput,
  OfflinePaymentInput,
  PaymentLinkInput,
  ReasonInput,
  RefundInput,
} from './booking.schemas.js';
import { BookingsService } from './bookings.service.js';
import { CancellationsService } from './cancellations.service.js';
import { ChangesService } from './changes.service.js';
import { GatewayRefundsService } from './gateway-refunds.service.js';
import { PaymentLinksService } from './payment-links.service.js';
import { REFERENCE, UUID, valid } from './ids.js';

/** Operations console API for concierge bookings (FS §12, §12.1). */
@Controller('bookings')
export class BookingsController {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PaymentLinksService) private readonly links: PaymentLinksService,
    @Inject(GatewayRefundsService) private readonly gatewayRefunds: GatewayRefundsService,
    @Inject(ChangesService) private readonly changes: ChangesService,
    @Inject(CancellationsService) private readonly cancellations: CancellationsService,
  ) {}

  /** FS §32 POST /bookings/{id}/change-request — record what the customer asked for. */
  @Post(':reference/change-request')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  async changeRequest(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    await this.changes.create(id, parseBody(ChangeRequestInput, body), auth, req.correlationId);
    return this.bookings.detail(id);
  }

  /** FS §32 POST /bookings/{id}/cancel-request. */
  @Post(':reference/cancel-request')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  async cancelRequest(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    await this.cancellations.request(
      id,
      parseBody(CancellationInput, body),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(id);
  }

  /** D-11 — ask for a refund to the customer's online payment; a second person approves it. */
  @Post(':reference/refunds/gateway')
  @Roles('FINANCE', 'OPS_MANAGER')
  async gatewayRefund(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    await this.gatewayRefunds.request(
      id,
      parseBody(GatewayRefundInput, body),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(id);
  }

  /** D-19 extension step 1 — Finance or a manager records a refund they paid. */
  @Post(':reference/refunds')
  @Roles('FINANCE', 'OPS_MANAGER')
  async recordRefund(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    await this.cancellations.recordRefund(
      id,
      parseBody(RefundInput, body),
      auth,
      req.correlationId,
    );
    return this.bookings.detail(id);
  }

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

  /** D-11 — create a gateway payment link for the balance due and send it on WhatsApp. */
  @Post(':reference/payments/link')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE')
  async paymentLink(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const id = await this.bookings.idByReference(valid(reference, REFERENCE, 'booking reference'));
    const sent = await this.links.create(
      id,
      parseBody(PaymentLinkInput, body),
      auth,
      req.correlationId,
    );
    return { ...(await this.bookings.detail(id)), linkDelivery: sent };
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
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(PaymentLinksService) private readonly links: PaymentLinksService,
  ) {}

  /** MR-19 — read a link's payment from the gateway now (e.g. a webhook was missed). */
  @Post(':id/reconcile')
  @HttpCode(200)
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE')
  async reconcile(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const paymentId = valid(id, UUID, 'payment id');
    await this.links.reconcile(paymentId, req.correlationId, auth.userId);
    return this.bookings.detail(await this.links.bookingOf(paymentId));
  }

  /** Stop an unpaid payment link. */
  @Post(':id/cancel-link')
  @HttpCode(200)
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER', 'FINANCE')
  async cancelLink(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    const paymentId = valid(id, UUID, 'payment id');
    await this.links.cancel(paymentId, auth, req.correlationId);
    return this.bookings.detail(await this.links.bookingOf(paymentId));
  }

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

/**
 * FS §32 POST /payments/webhook — gateway notifications. Public, but only signed requests are
 * accepted. The API is not on the internet: the website forwards the raw body here unchanged
 * (apps/web/app/webhooks/[provider]/route.ts) with the gateway's signature headers.
 */
/** Signature and delivery-id headers of Cashfree and Razorpay webhooks. */
const WEBHOOK_HEADERS = [
  'x-webhook-signature',
  'x-webhook-timestamp',
  'x-idempotency-key',
  'x-razorpay-signature',
  'x-razorpay-event-id',
];

@Controller('payments/webhook')
export class PaymentWebhooksController {
  constructor(@Inject(PaymentLinksService) private readonly links: PaymentLinksService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    if (!Buffer.isBuffer(body)) {
      throw new BadRequestException(`Send the raw body as ${GATEWAY_WEBHOOK_TYPE}`);
    }
    const header = (name: string) => {
      const v = req.headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    const ok = await this.links.receiveWebhook(
      provider,
      body,
      Object.fromEntries(WEBHOOK_HEADERS.map((name) => [name, header(name)])),
      req.correlationId,
    );
    if (!ok) throw new UnauthorizedException('Signature does not match');
    return { ok: true };
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
