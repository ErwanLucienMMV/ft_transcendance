import { expect, test } from '@playwright/test';

test('keeps unconfigured providers hidden without affecting local login', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toHaveCount(0);
});

test('shows enabled provider buttons and starts the server-owned authorization route', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/oauth/providers', (route) =>
    route.fulfill({ json: { providers: ['google', 'github'] } }),
  );
  await page.route('**/api/v1/auth/oauth/google', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Provider authorization started</h1>' }),
  );
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL(/\/api\/v1\/auth\/oauth\/google$/);
  await expect(page.getByRole('heading', { name: 'Provider authorization started' })).toBeVisible();
});

test('renders callback refusal without requesting a session or leaking a token', async ({
  page,
}) => {
  let exchanged = false;
  page.on('request', (req) => {
    if (req.url().endsWith('/auth/oauth/exchange')) exchanged = true;
  });
  await page.goto('/oauth/callback?error=existing-account');
  await expect(page).toHaveTitle('Completing sign-in | 42 Chess');
  await expect(page.getByRole('alert')).toContainText('Sign in normally');
  expect(exchanged).toBe(false);
  await page.getByRole('link', { name: 'Return to sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('hands OAuth 2FA challenges to the existing second-factor screen', async ({ page }) => {
  await page.route('**/api/v1/auth/oauth/exchange', async (route) => {
    expect(route.request().headers()['x-oauth-exchange']).toBe('1');
    await route.fulfill({ json: { requires2fa: true, challengeToken: 'browser-only-challenge' } });
  });
  await page.goto('/oauth/callback');
  await expect(page).toHaveURL(/\/two-factor$/);
  await expect(page.getByLabel('Authenticator code')).toBeVisible();
  expect(page.url()).not.toContain('challenge');
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
});
