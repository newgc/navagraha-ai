import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { AuthContext, AuthedRequest } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { parseBody } from '../common/zod.js';
import {
  AcceptProposalInput,
  LeadProposalInput,
  ReasonInput,
  TripRequestInput,
} from './booking.schemas.js';
import { REFERENCE, valid } from './ids.js';
import { LeadsService } from './leads.service.js';

const REQUEST_REFERENCE = /^REQ-\d{6,}$/;

/** Trip requests from the website (self-service, first version): customers send, operations plan. */
@Controller('trip-requests')
export class TripRequestsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  /** A signed-in customer (phone verified by a WhatsApp code) sends a trip request. */
  @Post()
  @Roles('CUSTOMER')
  submit(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    return this.leads.submit(parseBody(TripRequestInput, body), auth, req.correlationId);
  }

  @Get()
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  list(@Query('state') state?: string) {
    return this.leads.list(state);
  }

  @Get(':reference')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  get(@Param('reference') reference: string) {
    return this.leads.detail(valid(reference, REQUEST_REFERENCE, 'request reference'));
  }

  @Post(':reference/planning')
  @HttpCode(200)
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  plan(
    @Param('reference') reference: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.leads.startPlanning(
      valid(reference, REQUEST_REFERENCE, 'request reference'),
      auth,
      req.correlationId,
    );
  }

  /** Send the customer a plan and price (a new version replaces the previous one). */
  @Post(':reference/proposals')
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  propose(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.leads.propose(
      valid(reference, REQUEST_REFERENCE, 'request reference'),
      parseBody(LeadProposalInput, body),
      auth,
      req.correlationId,
    );
  }

  @Post(':reference/lost')
  @HttpCode(200)
  @Roles('OPS_COORDINATOR', 'OPS_MANAGER')
  lost(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.leads.markLost(
      valid(reference, REQUEST_REFERENCE, 'request reference'),
      parseBody(ReasonInput, body).reason,
      auth,
      req.correlationId,
    );
  }
}

/** The signed-in customer's own requests and bookings (FS §4.10 customer trip dashboard). */
@Controller('my')
@Roles('CUSTOMER')
export class MyTripsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  @Get('trips')
  trips(@CurrentAuth() auth: AuthContext) {
    return this.leads.mine(auth);
  }

  @Get('trip-requests/:reference')
  request(@Param('reference') reference: string, @CurrentAuth() auth: AuthContext) {
    return this.leads.myRequest(valid(reference, REQUEST_REFERENCE, 'request reference'), auth);
  }

  @Post('trip-requests/:reference/accept')
  @HttpCode(200)
  accept(
    @Param('reference') reference: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.leads.accept(
      valid(reference, REQUEST_REFERENCE, 'request reference'),
      parseBody(AcceptProposalInput, body).version,
      auth,
      req.correlationId,
    );
  }

  @Get('bookings/:reference')
  booking(@Param('reference') reference: string, @CurrentAuth() auth: AuthContext) {
    return this.leads.myBooking(valid(reference, REFERENCE, 'booking reference'), auth);
  }

  /** "Pay now": the gateway link for the balance; payment is recorded only from the gateway. */
  @Post('bookings/:reference/pay')
  @HttpCode(200)
  pay(
    @Param('reference') reference: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    return this.leads.pay(
      valid(reference, REFERENCE, 'booking reference'),
      auth,
      req.correlationId,
    );
  }
}
