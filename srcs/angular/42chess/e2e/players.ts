import { APIRequestContext, Browser, expect, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const PASSWORD = ' exact password 42 ';

/** Registers and verifies an account through the real API and mail capture. */
export async function verifiedAccount(request: APIRequestContext): Promise<string> {
  const username = `u_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const email = `${username}@example.com`;
  const mailUrl = process.env['TEST_MAIL_URL'];
  if (!mailUrl) throw new Error('TEST_MAIL_URL must identify the isolated mail capture.');
  expect(
    (
      await request.post('/api/v1/auth/register', { data: { username, email, password: PASSWORD } })
    ).ok(),
  ).toBe(true);
  const mail = await request.get(`${mailUrl}/_test/message?to=${encodeURIComponent(email)}`);
  const { token } = await mail.json();
  expect((await request.post('/api/v1/auth/verify-email', { data: { token } })).ok()).toBe(true);
  return username;
}

/** A separate browser context per player, so each one has its own session cookie. */
export async function signedIn(browser: Browser, username: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Username or email address').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/session$/);
  return page;
}
