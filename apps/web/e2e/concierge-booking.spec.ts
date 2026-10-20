import { expect, test } from '@playwright/test';
import { STAFF, signIn, signOut } from './staff';

/** Set E2E_SCREENSHOTS=<dir> to save full-page screenshots of the key screens. */
async function snap(page: import('@playwright/test').Page, name: string) {
  if (process.env.E2E_SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
  }
}

test('operations console: sign-in is required', async ({ page }) => {
  await page.goto('/ops');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('a coordinator takes a phone booking and finance confirms the payment', async ({ page }) => {
  await signIn(page, STAFF.coordinator);
  await page.getByRole('link', { name: 'New booking' }).click();

  // Booker and travellers.
  await page.getByLabel('Mobile number').fill('98450 12345');
  await page.getByLabel('Name', { exact: true }).first().fill('Priya Raman');
  await page.getByLabel('Traveller 1 name').fill('Priya Raman');
  await page.getByRole('button', { name: 'Add traveller' }).click();
  await page.getByLabel('Traveller 2 name').fill('Kamala Raman');
  await page
    .locator('select')
    .filter({ hasText: 'Adult 18–59' })
    .nth(1)
    .selectOption('SENIOR_60_74');
  await page.locator('select').filter({ hasText: 'Booker themself' }).nth(1).selectOption('PARENT');
  await page.getByLabel('Vehicle seats').fill('7');
  await page.getByLabel('Pickup location').fill('Kumbakonam railway station');

  // Quote.
  await page.getByLabel('Line 1 description').fill('Innova Crysta, 1 day');
  await page.getByLabel('Line 1 price').fill('4500');
  await page.getByLabel('Line 1 tax').fill('225');
  await expect(page.getByText('Estimated total: ₹4,725.00')).toBeVisible();

  // Without the D-20 sign-off the form refuses.
  await page.getByRole('button', { name: 'Create booking' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'checked temple timings' })).toBeVisible();
  await page.getByLabel(/I have checked temple opening hours/).check();
  await expect(page.getByRole('alert').filter({ hasText: 'checked temple timings' })).toHaveCount(
    0,
  );
  await snap(page, '1-new-booking');
  await page.getByRole('button', { name: 'Create booking' }).click();

  // Booking detail.
  await expect(page.getByRole('heading', { name: /NAV-\d{6}/ })).toBeVisible();
  await expect(page.getByText('Waiting for payment and supplier confirmation')).toBeVisible();
  await expect(page.getByText(/not checked by the planning engine/)).toBeVisible();
  await expect(page.getByText('Senior-Friendly')).toBeVisible();
  const reference = (await page.getByRole('heading', { name: /NAV-\d{6}/ }).textContent())!.match(
    /NAV-\d{6}/,
  )![0];

  // Supplier: request, then confirm with reference and seats.
  await page.getByLabel('Supplier', { exact: true }).fill('Sri Murugan Travels');
  await page.getByRole('button', { name: 'Mark as requested' }).click();
  await page.getByLabel('Supplier reference').fill('SMT-2231');
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('Waiting for payment', { exact: true })).toBeVisible();

  // Payment recorded by the coordinator…
  await page.getByText('Record a payment received').click();
  await page.getByLabel('Amount (₹)').fill('4725');
  await page.getByLabel('UPI / bank reference or receipt no.').fill('UPI-552301');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(/You recorded this — someone else/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm received' })).toHaveCount(0);
  await snap(page, '2-awaiting-finance');
  await signOut(page);

  // …and confirmed by finance (D-19).
  await signIn(page, STAFF.finance);
  await expect(page.getByRole('link', { name: 'New booking' })).toHaveCount(0);
  await page.getByRole('link', { name: reference }).click();
  await page.getByRole('button', { name: 'Confirm received' }).click();
  await expect(
    page.getByText('Confirmed: payment and all required suppliers are done'),
  ).toBeVisible();
  await expect(page.getByText('Trip scheduled')).toBeVisible();
  await expect(page.getByText(/₹4,725.00 · UPI · UPI-552301/)).toBeVisible();
  await expect(page.getByRole('heading', { name: reference })).toContainText('Confirmed');
  await snap(page, '3-confirmed');
  await page.getByRole('link', { name: 'Bookings' }).click();
  await snap(page, '4-bookings-list');
});
