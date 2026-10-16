import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('registers, refuses unverified login, verifies email and signs in against the real API', async ({
  page,
  request,
}) => {
  const username = `u_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const email = `${username}@example.com`;
  const password = ' exact password 42 ';
  await page.goto('/register');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Account created.');
  await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Username or email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Verify your email');
  const mailUrl = process.env['TEST_MAIL_URL'];
  if (!mailUrl) throw new Error('TEST_MAIL_URL must identify the isolated mail capture.');
  const mail = await request.get(`${mailUrl}/_test/message?to=${encodeURIComponent(email)}`);
  expect(mail.ok()).toBe(true);
  const { token } = await mail.json();
  await page.goto(`/verify-email?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('status')).toContainText('Your email is verified.');
  await page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Username or email address').fill(username);
  await page.getByLabel('Password', { exact: true }).fill('wrong password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect username');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByRole('status')).toHaveText(`Welcome, ${username}.`);
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
  await page.getByRole('button', { name: 'Sign out of this tab', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Username or email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/session$/);
  await page.reload();
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsession$/);
});

test('redirects anonymous access to a protected page', async ({ page }) => {
  await page.goto('/session');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsession$/);
});
