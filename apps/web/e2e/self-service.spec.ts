import { expect, test } from '@playwright/test';
import { STAFF, latestCode, signIn } from './staff';

/**
 * Self-service, first version: a customer sends a trip request from the website (number
 * verified with a code), a coordinator sends a plan and price, the customer accepts it.
 */
test('a customer requests a pilgrimage, gets a plan and books it', async ({ browser }) => {
  const customer = await (await browser.newContext()).newPage();
  const phone = '+919900011223';

  // 1. The customer fills in the request without signing in first.
  await customer.goto('/');
  await customer.getByRole('link', { name: 'Plan My Pilgrimage' }).first().click();
  await customer.getByLabel('Pickup (city or area)').fill('Chennai, Anna Nagar');
  await customer.getByLabel('How long').selectOption('2');
  await customer.getByLabel('Name', { exact: true }).fill('Meena');
  await customer.getByRole('button', { name: 'Add a traveller' }).click();
  await customer.getByLabel('Name', { exact: true }).nth(1).fill('Lakshmi');
  // Each traveller row: age is its first select.
  await customer
    .locator('.traveller')
    .nth(1)
    .locator('select')
    .first()
    .selectOption('SENIOR_75_PLUS');
  await customer.getByLabel('Needs a wheelchair').nth(1).check();
  await customer.getByLabel('Your name').fill('Meena');
  await customer.getByLabel('Mobile number (WhatsApp)').fill('99000 11223');
  await customer.getByRole('button', { name: 'Verify my number and send' }).click();
  await customer.getByLabel(/Enter the 6-digit code/).fill(await latestCode(phone));
  await customer.getByRole('button', { name: 'Send my request' }).click();

  await expect(customer.getByRole('heading', { name: /Request REQ-\d{6}/ })).toBeVisible();
  await expect(customer.getByText(/Our team is planning your pilgrimage/)).toBeVisible();
  const ref = (await customer.getByRole('heading', { name: /REQ-\d{6}/ }).textContent())!.match(
    /REQ-\d{6}/,
  )![0];

  // 2. A coordinator plans and prices it.
  const ops = await (await browser.newContext()).newPage();
  await signIn(ops, STAFF.planner);
  await ops.getByRole('link', { name: 'Trip requests' }).click();
  await ops.getByRole('link', { name: ref }).click();
  await expect(ops.getByText('Chennai, Anna Nagar')).toBeVisible();
  await expect(ops.getByText(/Lakshmi · Senior 75\+ · Parent · wheelchair/)).toBeVisible();
  // The planning engine refuses to guess: this database has no verified timings yet.
  await ops.getByRole('button', { name: 'Suggest plans' }).click();
  await expect(ops.getByText('The engine cannot plan yet:')).toBeVisible();
  await expect(ops.getByText(/verified opening hours are missing/).first()).toBeVisible();

  await ops.getByLabel('Line 1 description').fill('Innova Crysta, 2 days');
  await ops.getByLabel('Line 1 price').fill('9000');
  await ops.getByLabel(/I have checked temple opening hours/).check();
  await ops.getByRole('button', { name: 'Send proposal' }).click();
  await expect(ops.getByRole('status').filter({ hasText: 'Proposal v1 sent' })).toBeVisible();

  // 3. The customer sees the plan and accepts it.
  await customer.reload();
  await expect(customer.getByText('Your plan is ready')).toBeVisible();
  await expect(customer.getByText('Thirunallar')).toBeVisible();
  await expect(customer.getByText('₹9,000.00').first()).toBeVisible();
  await customer.getByRole('button', { name: 'Accept and book' }).click();
  await expect(customer.getByRole('heading', { name: /Booking NAV-\d{6} · Booked/ })).toBeVisible();
  await expect(customer.getByText(/Due ₹9,000.00/)).toBeVisible();
  await expect(
    customer.getByText('Arrangements confirmed: 0 of 2.', { exact: false }),
  ).toBeVisible();

  // 4. My trips lists the booking; operations see where it came from.
  await customer.getByRole('link', { name: '← My trips' }).click();
  await expect(customer.getByRole('heading', { name: 'Bookings' })).toBeVisible();
  await ops.reload();
  await expect(ops.getByText(/Accepted and booked as NAV-\d{6}/)).toBeVisible();
});
