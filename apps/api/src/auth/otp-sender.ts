import { appendFile } from 'node:fs/promises';
import { maskPhone } from '@navagraha/domain';
import { Logger } from '@nestjs/common';

/** Delivers sign-in codes. Implementations sit behind this adapter (FS §2.2, D-11). */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Prints the code to the API log. Development and staging only; refused in production by config. */
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  async send(phone: string, code: string) {
    // Never log full phone numbers; the last four digits are enough to match a code to a person.
    this.logger.warn(
      `Sign-in code for ${maskPhone(phone)}: ${code} (console sender — no SMS provider yet)`,
    );
  }
}

/** Development / browser tests only: appends `phone code` lines to a file. Refused in production by config. */
export class FileOtpSender implements OtpSender {
  constructor(private readonly path: string) {}

  async send(phone: string, code: string) {
    await appendFile(this.path, `${phone} ${code}\n`);
  }
}
