import type { NestExpressApplication } from '@nestjs/platform-express';
import { correlationId } from './common/correlation-id.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { MAX_WORKBOOK_BYTES, XLSX_TYPE } from './temple-data/temple-data.controller.js';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: NestExpressApplication) {
  app.disable('x-powered-by');
  // The web app calls the API from the same server and passes the visitor's address in
  // X-Forwarded-For; trust it only from loopback so rate limits see real visitors.
  app.set('trust proxy', 'loopback');
  app.use(correlationId);
  // Workbook uploads arrive as a raw body; JSON stays the default for everything else.
  app.useBodyParser('raw', { type: XLSX_TYPE, limit: MAX_WORKBOOK_BYTES });
  app.useGlobalFilters(new HttpExceptionFilter());
  // FS §15: all APIs are versioned.
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  return app;
}
