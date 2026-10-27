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
  // The access token stays in memory; the httpOnly refresh cookie restores it on reload.
  await page.reload();
  await expect(page).toHaveURL(/\/session$/);
  await expect(page.getByRole('status')).toHaveText(`Welcome, ${username}.`);
  expect((await page.context().cookies()).find((c) => c.name === 'refresh_token')).toMatchObject({
    httpOnly: true,
    sameSite: 'Strict',
    path: '/api/v1/auth',
  });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await page.goto('/session');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsession$/);
  await page.getByLabel('Username or email address').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const signedIn = page.waitForResponse(
    (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/session$/);
  const identity = await (await signedIn).json();
  const authenticated = await page.evaluate(
    (token: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(`ws://${location.host}/ws`);
        const testWindow = window as Window & { testSocketClosed?: Promise<number> };
        testWindow.testSocketClosed = new Promise<number>(
          (closed) => (socket.onclose = (event) => closed(event.code)),
        );
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('JWT socket handshake timed out'));
        }, 5000);
        socket.onopen = () =>
          socket.send(JSON.stringify({ event: 'AUTHENTICATE', data: { accessToken: token } }));
        socket.onmessage = (message) => {
          const packet = JSON.parse(message.data);
          clearTimeout(timeout);
          if (packet.event === 'AUTHENTICATED') {
            socket.onmessage = null;
            resolve(packet.data.userId);
          } else {
            socket.close();
            reject(new Error('JWT socket authentication failed'));
          }
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('JWT socket upgrade failed'));
        };
      }),
    identity.accessToken,
  );
  expect(authenticated).toBe(identity.user.id);
  const logout = page.waitForResponse(
    (r) => r.url().endsWith('/auth/logout') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect((await logout).status()).toBe(204);
  expect(
    await page.evaluate(() =>
      Promise.race([
        (window as Window & { testSocketClosed?: Promise<number> }).testSocketClosed,
        new Promise<number>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error('Logout did not close the authenticated socket')),
            5000,
          ),
        ),
      ]),
    ),
  ).toBe(4401);
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/session');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsession$/);
});

test('redirects anonymous access to a protected page', async ({ page }) => {
  await page.goto('/session');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fsession$/);
});
