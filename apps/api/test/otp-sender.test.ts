import { describe, expect, it } from 'vitest';
import { LogCopyOtpSender, WhatsAppOtpSender, type OtpSender } from '../src/auth/otp-sender.js';
import { HashwaWhatsApp } from '../src/messaging/whatsapp.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; form: FormData }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, form: init.body as FormData });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const options = { apiUrl: 'https://eco.hashwa.in/api/', secret: 'the-secret', account: 'acc-1' };

describe('HashwaWhatsApp (D-11)', () => {
  it('sends a priority WhatsApp text from the linked account', async () => {
    const { fetch, calls } = fakeFetch(200, {
      status: 200,
      message: 'WhatsApp chat has been sent!',
      data: { messageId: 1 },
    });
    await new HashwaWhatsApp({ ...options, fetch }).sendText('+919876543210', 'hello');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://eco.hashwa.in/api/send/whatsapp');
    expect(Object.fromEntries(calls[0]!.form.entries())).toEqual({
      secret: 'the-secret',
      account: 'acc-1',
      recipient: '+919876543210',
      type: 'text',
      priority: '1',
      message: 'hello',
    });
  });

  it('fails when Hashwa refuses, without putting the secret in the error', async () => {
    const { fetch } = fakeFetch(200, { status: 403, message: 'Invalid API secret' });
    const error = await new HashwaWhatsApp({ ...options, fetch })
      .sendText('+919876543210', 'hi')
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/did not send.*Invalid API secret/);
    expect((error as Error).message).not.toContain('the-secret');
  });

  it('fails on an HTTP error or an unreadable reply', async () => {
    const { fetch } = fakeFetch(502, 'Bad Gateway');
    await expect(
      new HashwaWhatsApp({ ...options, fetch }).sendText('+919876543210', 'hi'),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe('WhatsAppOtpSender', () => {
  it('sends the code with how long it lasts', async () => {
    const sent: string[] = [];
    const sender = new WhatsAppOtpSender({ sendText: async (_p, t) => void sent.push(t) }, 5);
    await sender.send('+919876543210', '123456');
    expect(sender.channel).toBe('whatsapp');
    expect(sent[0]).toMatch(/^123456 is your Navagraha AI sign-in code\. It expires in 5 minutes/);
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
