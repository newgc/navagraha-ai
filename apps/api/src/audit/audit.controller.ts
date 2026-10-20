import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators.js';
import { AuditService } from './audit.service.js';

/** MR-52 — minimal audit log viewer for managers and administrators. */
@Controller('audit-log')
@Roles('OPS_MANAGER', 'SYSTEM_ADMIN')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  async latest(@Query('limit') limit = '50') {
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      throw new BadRequestException('limit must be 1–200');
    }
    return { entries: await this.audit.latest(n) };
  }
}
