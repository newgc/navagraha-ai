import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { OTP_OUTBOX } from '../playwright.config';

export const FILLED_WORKBOOK = path.join(path.dirname(OTP_OUTBOX), 'filled-workbook.xlsx');

export const STAFF = {
  coordinator: {
    phone: '+917000099001',
    typed: '70000 99001',
    name: 'Meena (Coordinator)',
    role: 'OPS_COORDINATOR',
  },
  finance: {
    phone: '+917000099002',
    typed: '70000 99002',
    name: 'Arun (Finance)',
    role: 'FINANCE',
  },
  // A second coordinator, so a test never waits out the 30 s resend cooldown on one number.
  coordinator2: {
    phone: '+917000099004',
    typed: '70000 99004',
    name: 'Selvi (Coordinator)',
    role: 'OPS_COORDINATOR',
  },
  content: {
    phone: '+917000099003',
    typed: '70000 99003',
    name: 'Lakshmi (Content)',
    role: 'CONTENT_ADMIN',
  },
} as const;

async function latestCode(phone: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const lines = (await readFile(OTP_OUTBOX, 'utf8'))
      .trim()
      .split('\n')
      .filter((l) => l.startsWith(phone));
    const code = lines.at(-1)?.split(' ')[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No sign-in code for ${phone}`);
}

/** Signs in through the real OTP screens and waits for the landing page. */
export async function signIn(
  page: Page,
  who: (typeof STAFF)[keyof typeof STAFF],
  landing = 'Bookings',
) {
  await page.goto('/sign-in');
  await page.getByLabel('Mobile number').fill(who.typed);
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('We sent a 6-digit code')).toBeVisible();
  await page.getByLabel('Code').fill(await latestCode(who.phone));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: landing })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}
