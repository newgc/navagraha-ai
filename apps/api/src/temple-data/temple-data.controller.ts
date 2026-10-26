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
import { SOURCE_TYPES } from '@navagraha/domain';
import { z } from 'zod';
import type { AuthContext, AuthedRequest } from '../auth/auth.types.js';
import { CurrentAuth, Roles } from '../auth/decorators.js';
import { parseBody } from '../common/zod.js';
import { FactChecksService } from './fact-checks.service.js';
import { TempleDataService } from './temple-data.service.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'should be a date (YYYY-MM-DD)');
const SubjectKey = text(300);
const CheckInput = z.object({
  subjectKey: SubjectKey,
  field: text(60),
  value: text(200),
  source: text(300),
  sourceType: z.enum(SOURCE_TYPES),
  sourceUrl: z.url().max(500).optional(),
  observedOn: isoDate,
  note: text(1000).optional(),
});
const VerifyInput = z.object({
  subjectKey: SubjectKey,
  source: text(300),
  sourceType: z.enum(SOURCE_TYPES),
  checkedOn: isoDate,
  note: text(1000).optional(),
});
const ConflictInput = z.object({ subjectKey: SubjectKey, note: text(1000) });
const ReasonInput = z.object({ reason: text(1000) });
const QUEUE_VIEWS = ['conflicts', 'recheck', 'unverified', 'all'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Settling a fact is for content admins and operations managers (V2 §26). */
const DECIDERS = ['CONTENT_ADMIN', 'OPS_MANAGER', 'SYSTEM_ADMIN'] as const;

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
/** Every .xlsx file is a zip archive, which starts with these bytes. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Temple master data for content and operations staff. */
@Controller('admin/temple-data')
@Roles('CONTENT_ADMIN', 'OPS_MANAGER', 'OPS_COORDINATOR', 'SYSTEM_ADMIN')
export class TempleDataController {
  constructor(
    @Inject(TempleDataService) private readonly data: TempleDataService,
    @Inject(FactChecksService) private readonly checks: FactChecksService,
  ) {}

  /** The Data Verification Queue (V2 §26). */
  @Get('queue')
  queue(@Query('view') view?: string, @Query('temple') temple?: string) {
    const v = (QUEUE_VIEWS as readonly string[]).includes(view ?? '')
      ? (view as (typeof QUEUE_VIEWS)[number])
      : 'all';
    if (temple && !/^[A-Z0-9-]{3,32}$/.test(temple)) {
      throw new BadRequestException('Invalid temple code');
    }
    return this.checks.queue(v, temple);
  }

  /** A second source for one fact. Recording one decides nothing. */
  @Post('checks')
  @HttpCode(201)
  addCheck(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    return this.checks.addCheck(parseBody(CheckInput, body), auth, req.correlationId);
  }

  @Post('checks/:id/accept')
  @HttpCode(204)
  @Roles(...DECIDERS)
  async accept(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid check id');
    await this.checks.accept(id, auth, req.correlationId);
  }

  @Post('checks/:id/reject')
  @HttpCode(204)
  @Roles(...DECIDERS)
  async reject(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    if (!UUID.test(id)) throw new BadRequestException('Invalid check id');
    await this.checks.reject(id, parseBody(ReasonInput, body).reason, auth, req.correlationId);
  }

  @Post('facts/verify')
  @HttpCode(204)
  @Roles(...DECIDERS)
  async verify(@Body() body: unknown, @CurrentAuth() auth: AuthContext, @Req() req: AuthedRequest) {
    await this.checks.verify(parseBody(VerifyInput, body), auth, req.correlationId);
  }

  @Post('facts/mark-conflicting')
  @HttpCode(204)
  @Roles(...DECIDERS)
  async markConflicting(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @Req() req: AuthedRequest,
  ) {
    await this.checks.markConflicting(parseBody(ConflictInput, body), auth, req.correlationId);
  }

  @Get()
  overview() {
    return this.data.overview();
  }

  @Get('imports')
  imports() {
    return this.data.imports();
  }

  @Get('temples/:code')
  temple(@Param('code') code: string) {
    if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new BadRequestException('Invalid temple code');
    return this.data.temple(code);
  }

  /**
   * Upload the temple data workbook as the raw request body (Content-Type: XLSX).
   * `?apply=true` imports it; otherwise it is only checked. Importing is for content admins.
   */
  @Post('import')
  @HttpCode(200)
  @Roles('CONTENT_ADMIN', 'SYSTEM_ADMIN')
  async import(
    @Req() req: AuthedRequest,
    @CurrentAuth() auth: AuthContext,
    @Query('apply') apply?: string,
    @Query('fileName') fileName?: string,
  ) {
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new BadRequestException(
        `Send the workbook as the request body with Content-Type ${XLSX_TYPE}`,
      );
    }
    if (!body.subarray(0, 4).equals(ZIP_MAGIC)) {
      throw new BadRequestException('That file is not an Excel workbook (.xlsx)');
    }
    return this.data.importWorkbook(body, {
      apply: apply === 'true',
      fileName: (fileName ?? 'workbook.xlsx').replace(/[^\w.\- ]/g, '_').slice(0, 120),
      auth,
      correlationId: req.correlationId,
    });
  }
}
