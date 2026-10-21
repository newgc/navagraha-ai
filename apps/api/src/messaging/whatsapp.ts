import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** Sends a plain WhatsApp text to a phone number (E.164). D-11: Hashwa today. */
export interface WhatsAppMessenger {
  sendText(phone: string, text: string): Promise<void>;
}

/** Injection token; resolves to null when WhatsApp is not configured. */
export const WHATSAPP = Symbol('WHATSAPP');

export interface HashwaOptions {
  /** e.g. https://eco.hashwa.in/api */
  apiUrl: string;
  /** API secret from Hashwa → Tools → API Keys (needs the "wa_send" permission). */
  secret: string;
  /** Unique ID of the linked WhatsApp account that sends the messages. */
  account: string;
  fetch?: typeof fetch;
}

/**
 * Hashwa `POST /send/whatsapp` (API doc 10.07.25): a text from the WhatsApp account linked in
 * Hashwa, sent with priority because a person is usually waiting for it.
 */
export class HashwaWhatsApp implements WhatsAppMessenger {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: HashwaOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  async sendText(phone: string, text: string) {
    const form = new FormData();
    form.set('secret', this.options.secret);
    form.set('account', this.options.account);
    form.set('recipient', phone);
    form.set('type', 'text');
    form.set('priority', '1');
    form.set('message', text);

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

export function whatsAppFromConfig(config: AppConfig): WhatsAppMessenger | null {
  if (!config.WHATSAPP_API_SECRET || !config.WHATSAPP_ACCOUNT) return null;
  return new HashwaWhatsApp({
    apiUrl: config.HASHWA_API_URL,
    secret: config.WHATSAPP_API_SECRET,
    account: config.WHATSAPP_ACCOUNT,
  });
}

@Global()
@Module({
  providers: [{ provide: WHATSAPP, useFactory: whatsAppFromConfig, inject: [APP_CONFIG] }],
  exports: [WHATSAPP],
})
export class MessagingModule {}
