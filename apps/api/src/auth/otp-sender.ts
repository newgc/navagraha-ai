import { appendFile } from 'node:fs/promises';
import { maskPhone } from '@navagraha/domain';
import { Logger } from '@nestjs/common';

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

export interface HashwaOptions {
  /** e.g. https://eco.hashwa.in/api */
  apiUrl: string;
  /** API secret from Hashwa → Tools → API Keys (needs the "wa_send" permission). */
  secret: string;
  /** Unique ID of the linked WhatsApp account that sends the message. */
  account: string;
  /** Shown in the message so the person knows how long the code lasts. */
  expiresInMinutes: number;
  fetch?: typeof fetch;
}

/**
 * WhatsApp through Hashwa (D-11). Sends our own code as a text from the linked WhatsApp
 * account. Hashwa's /send/otp would generate and check codes itself; we keep codes, attempt
 * limits and audit in our database instead, so the provider can change without touching
 * sign-in.
 */
export class HashwaWhatsAppOtpSender implements OtpSender {
  readonly channel: OtpChannel = 'whatsapp';
  private readonly fetch: typeof fetch;

  constructor(private readonly options: HashwaOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async send(phone: string, code: string) {
    const form = new FormData();
    form.set('secret', this.options.secret);
    form.set('account', this.options.account);
    form.set('recipient', phone);
    form.set('type', 'text');
    // A person is waiting on the sign-in page: ask Hashwa to send it straight away.
    form.set('priority', '1');
    form.set(
      'message',
      `${code} is your Navagraha AI sign-in code. It expires in ${this.options.expiresInMinutes} ` +
        'minutes. Do not share it with anyone — our team will never ask for it.',
    );

    // The secret travels in the body, never in the URL, so it cannot end up in an error.
    const url = `${this.options.apiUrl.replace(/\/+$/, '')}/send/whatsapp`;
    let res: Response;
    try {
      res = await this.fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new Error(`Hashwa could not be reached: ${(err as Error).message}`);
    }
    const reply = (await res.json().catch(() => null)) as {
      status?: number;
      message?: string;
    } | null;
    if (!res.ok || reply?.status !== 200) {
      const detail = reply?.message ? `: ${reply.message}` : '';
      throw new Error(`Hashwa did not send the message (HTTP ${res.status}${detail})`);
    }
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
