import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { schema, type Database } from '@navagraha/db';
import { MODES, TEMPLATES, TRIP_PURPOSES } from '@navagraha/domain';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AuthedRequest } from '../auth/auth.types.js';
import { Roles } from '../auth/decorators.js';
import { parseBody } from '../common/zod.js';
import { DB } from '../db/db.module.js';
import { PlannerService } from './planner.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');
const placeCode = z.string().trim().min(1).max(40);
const Travellers = z
  .array(z.object({ ageBand: z.string().max(40), needsWheelchair: z.boolean().optional() }))
  .min(1)
  .max(50);

export const PlanInput = z.object({
  startDate: isoDate,
  startTime: hhmm.optional(),
  fromPlace: placeCode,
  toPlace: placeCode.optional(),
  temples: z.array(z.string().max(32)).max(30).optional(),
  travellers: Travellers,
  purpose: z.enum(TRIP_PURPOSES).default('ALL_NINE'),
  days: z.enum(['1', '2', 'RECOMMEND']).default('RECOMMEND'),
  /** Links the DecisionRecord to the website request it was made for. */
  leadReference: z
    .string()
    .regex(/^REQ-\d{6,}$/)
    .optional(),
});

export const EvaluateInput = z.object({
  template: z.enum(TEMPLATES),
  mode: z.enum(MODES),
  startDate: isoDate,
  startTime: hhmm.optional(),
  fromPlace: placeCode,
  toPlace: placeCode.optional(),
  travellers: Travellers,
  stops: z
    .array(z.object({ templeCode: z.string().max(32), day: z.number().int().min(1).max(3) }))
    .min(1)
    .max(30),
});

/** FS §9 planning engine for operations (P2). Customers get plans through proposals. */
@Controller('planner')
@Roles('OPS_COORDINATOR', 'OPS_MANAGER')
export class PlannerController {
  constructor(
    @Inject(PlannerService) private readonly planner: PlannerService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get('places')
  places() {
    return this.planner.places();
  }

  /** Candidates for every template × mode, scored and explained, from verified facts only. */
  @Post('plan')
  @HttpCode(200)
  async plan(@Body() body: unknown, @Req() req: AuthedRequest) {
    const { leadReference, ...input } = parseBody(PlanInput, body);
    const [lead] = leadReference
      ? await this.db
          .select({ id: schema.lead.id })
          .from(schema.lead)
          .where(eq(schema.lead.reference, leadReference))
      : [];
    return this.planner.plan(input, {
      userId: req.auth!.userId,
      correlationId: req.correlationId,
      leadId: lead?.id ?? null,
    });
  }

  /** A stored DecisionRecord (FS §8.2), e.g. to turn a candidate into a proposal. */
  @Get('decisions/:id')
  async decision(@Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException('Decision record not found');
    const [r] = await this.db
      .select()
      .from(schema.decisionRecord)
      .where(eq(schema.decisionRecord.id, id));
    if (!r) throw new NotFoundException('Decision record not found');
    return r;
  }

  /** Checks a hand-made itinerary exactly as ordered. */
  @Post('evaluate')
  @HttpCode(200)
  evaluate(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.planner.evaluate(parseBody(EvaluateInput, body), {
      userId: req.auth!.userId,
      correlationId: req.correlationId,
    });
  }
}
