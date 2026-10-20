import {
  BadRequestException,
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
import { TempleDataService } from './temple-data.service.js';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_WORKBOOK_BYTES = 5 * 1024 * 1024;
/** Every .xlsx file is a zip archive, which starts with these bytes. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Temple master data for content and operations staff. */
@Controller('admin/temple-data')
@Roles('CONTENT_ADMIN', 'OPS_MANAGER', 'OPS_COORDINATOR', 'SYSTEM_ADMIN')
export class TempleDataController {
  constructor(@Inject(TempleDataService) private readonly data: TempleDataService) {}

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
