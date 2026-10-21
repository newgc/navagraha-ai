import { describe, expect, it } from 'vitest';
import {
  HashwaWhatsAppOtpSender,
  LogCopyOtpSender,
  type OtpSender,
} from '../src/auth/otp-sender.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; form: FormData }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = {
  apiUrl: 'https://eco.hashwa.in/api/',
  secret: 'the-secret',
  account: 'acc-1',
  expiresInMinutes: 5,
};

describe('HashwaWhatsAppOtpSender (D-11)', () => {
  it('sends our code as a priority WhatsApp text from the linked account', async () => {
    const { fetch, calls } = fakeFetch(200, {
      status: 200,
      message: 'WhatsApp chat has been sent!',
      data: { messageId: 1 },
    });
    const sender = new HashwaWhatsAppOtpSender({ ...options, fetch });
    await sender.send('+919876543210', '123456');

    expect(sender.channel).toBe('whatsapp');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://eco.hashwa.in/api/send/whatsapp');
    const form = calls[0]!.form;
    expect(Object.fromEntries(form.entries())).toMatchObject({
      secret: 'the-secret',
      account: 'acc-1',
      recipient: '+919876543210',
      type: 'text',
      priority: '1',
    });
    expect(form.get('message')).toMatch(
      /^123456 is your Navagraha AI sign-in code\. It expires in 5 minutes/,
    );
  });

  it('fails when Hashwa refuses, without putting the secret in the error', async () => {
    const { fetch } = fakeFetch(200, { status: 403, message: 'Invalid API secret' });
    const sender = new HashwaWhatsAppOtpSender({ ...options, fetch });
    const error = await sender.send('+919876543210', '123456').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/did not send.*Invalid API secret/);
    expect((error as Error).message).not.toContain('the-secret');
  });

  it('fails on an HTTP error or an unreadable reply', async () => {
    const { fetch } = fakeFetch(502, 'Bad Gateway');
    await expect(
      new HashwaWhatsAppOtpSender({ ...options, fetch }).send('+919876543210', '1'),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe('LogCopyOtpSender (staging)', () => {
  it('keeps the inner channel and still fails when the inner sender fails', async () => {
    const inner: OtpSender = {
      channel: 'whatsapp',
      send: async () => {
        throw new Error('down');
      },
    };
    const sender = new LogCopyOtpSender(inner);
    expect(sender.channel).toBe('whatsapp');
    await expect(sender.send('+919876543210', '123456')).rejects.toThrow('down');
  });
});
