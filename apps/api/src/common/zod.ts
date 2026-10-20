import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Validates an untrusted request body; 400 lists the offending fields. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(
      r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    );
  }
  return r.data;
}
