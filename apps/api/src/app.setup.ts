import type { NestExpressApplication } from '@nestjs/platform-express';
import { correlationId } from './common/correlation-id.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';

/** Shared by main.ts and the e2e tests so both run the same pipeline. */
export function configureApp(app: NestExpressApplication) {
  app.disable('x-powered-by');
  app.use(correlationId);
  app.useGlobalFilters(new HttpExceptionFilter());
  // FS §15: all APIs are versioned.
  app.setGlobalPrefix('v1');
  app.enableShutdownHooks();
  return app;
}
