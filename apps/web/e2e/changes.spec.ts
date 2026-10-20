import { expect, test } from '@playwright/test';
import { STAFF, createPhoneBooking, signIn, signOut } from './staff';

function inDays(n: number) {
  const d = new Date(Date.now() + 5.5 * 3600_000);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test('a date change is proposed and applied, then the booking is cancelled by a manager', async ({
  page,
}) => {
  await signIn(page, STAFF.coordinator3);
  const reference = await createPhoneBooking(page, '94440 11223');

  // Record what the customer asked for.
  await page.getByText('Record a change the customer asked for').click();
  await page.getByLabel('What they asked for').fill('Move the trip two weeks later');
  await page.getByRole('button', { name: 'Record change request' }).click();
  await expect(page.getByText('Date: Move the trip two weeks later')).toBeVisible();

  // Prepare the proposal: new date, same plan and price.
  await page.getByRole('link', { name: 'Prepare proposal' }).click();
  await expect(page.getByRole('heading', { name: 'Propose a change' })).toBeVisible();
  await expect(page.getByLabel('Line 1 price')).toHaveValue('3000');
  await page.getByLabel('Travel date').fill(inDays(30));
  await page.getByLabel(/I have checked temple opening hours/).check();
  await page.getByRole('button', { name: 'Save proposal' }).click();

  await expect(page.getByRole('heading', { name: reference })).toBeVisible();
  await expect(page.getByText('New date')).toBeVisible();
  await page.getByRole('button', { name: 'Customer accepted — apply change' }).click();
  await expect(page.getByRole('heading', { name: /Itinerary v2/ })).toBeVisible();
  await expect(page.getByText(/Change \(date\): Move the trip two weeks later/)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/7-change-applied.png`,
      fullPage: true,
    });

  // Cancellation: the coordinator proposes the refund, a manager approves.
  await page.getByText('Record a cancellation request').click();
  await page.getByLabel('Reason').fill('Family emergency');
  await page.getByRole('button', { name: 'Record cancellation request' }).click();
  await page.getByLabel('Refund (₹)').fill('0');
  await page.getByLabel('Refund note').fill('Nothing has been paid yet');
  await page.getByRole('button', { name: 'Propose refund' }).click();
  await expect(page.getByText('Waiting for an operations manager to approve.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve cancellation' })).toHaveCount(0);
  await signOut(page);

  await signIn(page, STAFF.manager);
  await page.getByLabel('From').fill(inDays(0));
  await page.getByLabel('To').fill(inDays(60));
  await page.getByRole('button', { name: 'Show' }).click();
  await page.getByRole('link', { name: reference }).click();
  await page.getByRole('button', { name: 'Approve cancellation' }).click();
  await expect(page.getByRole('heading', { name: reference })).toContainText('Cancelled');
  await expect(page.getByText(/Cancellation: Family emergency/)).toBeVisible();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/8-cancelled.png`,
      fullPage: true,
    });
});
