import { BadRequestException } from '@nestjs/common';

export const REFERENCE = /^NAV-\d{6,}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function valid(value: string, re: RegExp, what: string) {
  if (!re.test(value)) throw new BadRequestException(`Invalid ${what}`);
  return value;
}
