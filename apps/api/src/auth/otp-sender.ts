import { appendFile } from 'node:fs/promises';
import { maskPhone } from '@navagraha/domain';
import { Logger } from '@nestjs/common';
import type { WhatsAppMessenger } from '../messaging/whatsapp.js';

/** Where the person should look for their code; the sign-in page says so. */
export type OtpChannel = 'whatsapp' | 'log';

/** Delivers sign-in codes. Implementations sit behind this adapter (FS §2.2, D-11). */
export interface OtpSender {
  readonly channel: OtpChannel;
  send(phone: string, code: string): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Prints the code to the API log. Development and staging only; refused in production by config. */
export class ConsoleOtpSender implements OtpSender {
  readonly channel: OtpChannel = 'log';
  private readonly logger = new Logger('OTP');

  constructor(private readonly note = 'console sender — not sent to the person') {}

  async send(phone: string, code: string) {
    // Never log full phone numbers; the last four digits are enough to match a code to a person.
    // The "Sign-in code for" wording is what the staging codes button looks for.
    this.logger.warn(`Sign-in code for ${maskPhone(phone)}: ${code} (${this.note})`);
  }
}

/** Development / browser tests only: appends `phone code` lines to a file. Refused in production by config. */
export class FileOtpSender implements OtpSender {
  readonly channel: OtpChannel = 'log';

  constructor(private readonly path: string) {}

  async send(phone: string, code: string) {
    await appendFile(this.path, `${phone} ${code}\n`);
  }
}

/**
 * WhatsApp (D-11). Sends our own code as a text through the configured WhatsApp messenger
 * (Hashwa). Hashwa's /send/otp would generate and check codes itself; we keep codes, attempt
 * limits and audit in our database instead, so the provider can change without touching
 * sign-in.
 */
export class WhatsAppOtpSender implements OtpSender {
  readonly channel: OtpChannel = 'whatsapp';

  constructor(
    private readonly whatsapp: WhatsAppMessenger,
    private readonly expiresInMinutes: number,
  ) {}

  async send(phone: string, code: string) {
    await this.whatsapp.sendText(
      phone,
      `${code} is your Navagraha AI sign-in code. It expires in ${this.expiresInMinutes} ` +
        'minutes. Do not share it with anyone — our team will never ask for it.',
    );
  }
}

/** Staging only: sends for real and keeps a copy in the log for the staging codes button. */
export class LogCopyOtpSender implements OtpSender {
  readonly channel: OtpChannel;
  private readonly copy = new ConsoleOtpSender('staging copy — also sent on WhatsApp');

  constructor(private readonly inner: OtpSender) {
    this.channel = inner.channel;
  }

  async send(phone: string, code: string) {
    await this.copy.send(phone, code);
    await this.inner.send(phone, code);
  }
}
