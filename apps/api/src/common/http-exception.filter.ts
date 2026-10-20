import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { CorrelatedRequest } from './correlation-id.js';

/**
 * Uniform error body. Unexpected errors never leak internals to the client;
 * the correlation ID lets support find the full log line.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<CorrelatedRequest>();
    const res = ctx.getResponse<Response>();
    const correlationId = req.correlationId;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      res.status(exception.getStatus()).json({
        statusCode: exception.getStatus(),
        message: message ?? exception.message,
        correlationId,
      });
      return;
    }

    this.logger.error(
      `Unhandled error [${correlationId}] ${req.method} ${req.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Something went wrong. Please quote the correlation ID when contacting support.',
      correlationId,
    });
  }
}
