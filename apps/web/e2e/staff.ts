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
  coordinator3: {
    phone: '+917000099005',
    typed: '70000 99005',
    name: 'Ravi (Coordinator)',
    role: 'OPS_COORDINATOR',
  },
  manager: {
    phone: '+917000099006',
    typed: '70000 99006',
    name: 'Divya (Manager)',
    role: 'OPS_MANAGER',
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

/** Creates a simple one-day phone booking through the form and returns its reference. */
export async function createPhoneBooking(page: Page, bookerPhone: string) {
  await page.getByRole('link', { name: 'New booking' }).click();
  await page.getByLabel('Mobile number').fill(bookerPhone);
  await page.getByLabel('Traveller 1 name').fill('Sundar');
  await page.getByLabel('Vehicle seats').fill('4');
  await page.getByLabel('Line 1 description').fill('Swift Dzire, 1 day');
  await page.getByLabel('Line 1 price').fill('3000');
  await page.getByLabel(/I have checked temple opening hours/).check();
  await page.getByRole('button', { name: 'Create booking' }).click();
  const heading = page.getByRole('heading', { name: /NAV-\d{6}/ });
  await expect(heading).toBeVisible();
  return (await heading.textContent())!.match(/NAV-\d{6}/)![0];
}
