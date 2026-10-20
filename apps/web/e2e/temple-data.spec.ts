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
  await signOut(page);
});

test('coordinators can see temple data but not upload', async ({ page }) => {
  await signIn(page, STAFF.coordinator2);
  await page.getByRole('link', { name: 'Temple data' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for the pilot?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upload the workbook' })).toHaveCount(0);
});
