import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export type CorrelatedRequest = Request & { correlationId: string };

/**
 * Every request carries a correlation ID (FS §2.2, NFR-16). A well-formed incoming
 * ID is kept so a trace can span client → API → provider; anything else is replaced.
 */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(CORRELATION_HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  (req as CorrelatedRequest).correlationId = id;
  res.setHeader(CORRELATION_HEADER, id);
  next();
}
