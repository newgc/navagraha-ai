import { expect, test } from '@playwright/test';
import { BOOTSTRAP_ADMIN, signIn, signOut } from './staff';

test('the bootstrap admin gives a new person a role, and that person can work', async ({
  page,
}) => {
  await signIn(page, BOOTSTRAP_ADMIN);
  await page.getByRole('link', { name: 'Team' }).click();
  await expect(page.getByRole('heading', { name: 'Team members' })).toBeVisible();

  await page.getByLabel('Mobile number').fill('70000 99777');
  await page.getByLabel('Name', { exact: true }).fill('Kavitha');
  await page.getByLabel('Role').selectOption('OPS_COORDINATOR');
  await page.getByRole('button', { name: 'Give role' }).click();
  const row = page.getByRole('row', { name: /Kavitha/ });
  await expect(row).toContainText('Ops coordinator');
  // An admin cannot remove their own admin role from this screen.
  await expect(page.getByRole('row', { name: /You/ }).getByText('System admin')).toBeVisible();
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/9-team.png`, fullPage: true });
  await signOut(page);

  await signIn(page, { phone: '+917000099777', typed: '70000 99777' });
  await expect(page.getByRole('link', { name: 'New booking' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0);
});
