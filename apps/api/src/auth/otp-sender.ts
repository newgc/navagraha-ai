import { appendFile } from 'node:fs/promises';
import { Logger } from '@nestjs/common';

/** Delivers sign-in codes. Implementations sit behind this adapter (FS §2.2, D-11). */
export interface OtpSender {
  send(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Development only: prints the code to the API log. Refused in production by config. */
export class ConsoleOtpSender implements OtpSender {
  private readonly logger = new Logger('OTP');

  async send(phone: string, code: string) {
    this.logger.warn(`Sign-in code for ${phone}: ${code} (console sender — development only)`);
  }
}

/** Development / browser tests only: appends `phone code` lines to a file. Refused in production by config. */
export class FileOtpSender implements OtpSender {
  constructor(private readonly path: string) {}

  async send(phone: string, code: string) {
    await appendFile(this.path, `${phone} ${code}\n`);
  }
}
