import { expect, test } from '@playwright/test';
import { FILLED_WORKBOOK, STAFF, signIn, signOut } from './staff';

test('a content admin checks and imports the workbook, and sees what is verified', async ({
  page,
}) => {
  // Content admins land on temple data, not bookings.
  await signIn(page, STAFF.content, 'Temple data');
  await expect(page.getByRole('link', { name: 'Bookings' })).toHaveCount(0);
  await expect(page.getByText('Temple records verified: 0 of 9')).toBeVisible();

  await page.getByLabel('Temple data workbook (.xlsx)').setInputFiles(FILLED_WORKBOOK);
  await page.getByRole('button', { name: 'Check only' }).click();
  await expect(page.getByText(/looks good\. Nothing written yet/)).toBeVisible();
  await expect(page.getByText('Temple records verified: 0 of 9')).toBeVisible();

  await page.getByLabel('Temple data workbook (.xlsx)').setInputFiles(FILLED_WORKBOOK);
  await page.getByRole('button', { name: 'Check and import' }).click();
  await expect(page.getByText('Imported filled-workbook.xlsx.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Temple records verified: 1 of 9')).toBeVisible();
  await expect(
    page.getByText('Temples with verified opening hours in force today: 1 of 9'),
  ).toBeVisible();
  await expect(page.getByText(/by Lakshmi \(Content\)/)).toBeVisible();

  await page.getByRole('link', { name: 'Thirunallar' }).click();
  await expect(page.getByRole('heading', { name: 'Thirunallar' })).toBeVisible();
  await expect(page.getByText('Sri Dharbaranyeswarar Temple', { exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: '05:30–12:30' })).toBeVisible();
  await expect(page.getByText('Temple office, by phone').first()).toBeVisible();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/6-temple-detail.png`,
      fullPage: true,
    });
  await page.getByRole('link', { name: '← Temple data' }).click();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/5-temple-data.png`,
      fullPage: true,
    });

  // V2 §26: a disagreeing second source is flagged, then settled in the verification queue.
  await page.getByRole('link', { name: 'Thirunallar' }).click();
  await page.getByRole('link', { name: 'Sources and second checks for this temple' }).click();
  const title = /Thirunallar — Morning hours/;
  const card = page.locator('section.fact-item', {
    has: page.getByRole('heading', { name: title }),
  });
  await expect(card.getByText('Verified', { exact: true })).toBeVisible();

  const add = card.locator('details', { hasText: 'Add a second source' });
  await add.getByText('Add a second source').click();
  await add.getByLabel('Fact').selectOption('closesAt');
  await add.getByLabel('What this source says').fill('12:00');
  await add.getByLabel('Source type').selectOption('PARTNER_DRIVER_GUIDE');
  await add.getByLabel('Who or which page').fill('Driver Murugan, this morning');
  await add.getByRole('button', { name: 'Record' }).click();
  await expect(add.getByRole('status')).toContainText('now conflicting');

  await page.getByRole('link', { name: /Conflicts/ }).click();
  await expect(card.getByText('Conflicting', { exact: true })).toBeVisible();
  await expect(card.getByRole('cell', { name: '12:00' })).toBeVisible();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/7-verification-queue.png`,
      fullPage: true,
    });
  if (process.env.E2E_SCREENSHOTS) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `${process.env.E2E_SCREENSHOTS}/8-verification-queue-phone.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await card.getByRole('button', { name: 'Update' }).click();
  // Settled: it leaves the conflicts list.
  await expect(page.getByText('Nothing here.')).toBeVisible();
  await page.getByRole('link', { name: /Everything/ }).click();
  await expect(card.getByText('Operational confirmed', { exact: true })).toBeVisible();
  await signOut(page);
});

test('coordinators can see temple data but not upload', async ({ page }) => {
  await signIn(page, STAFF.coordinator2);
  await page.getByRole('link', { name: 'Temple data' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the pilot?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upload the workbook' })).toHaveCount(0);
});
