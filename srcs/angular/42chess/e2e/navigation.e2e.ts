import { expect, test } from '@playwright/test';

test('navigates between public pages and retains the active navigation state', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Play chess', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page
    .getByRole('main')
    .getByRole('link', { name: 'Create an account', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Create an account', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Confirm password', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('opens the privacy policy and terms of service from the footer of any page', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/login');
  const legal = page.getByRole('contentinfo').getByRole('navigation', { name: 'Legal' });
  await legal.getByRole('link', { name: 'Privacy Policy', exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page).toHaveTitle('Privacy Policy | 42 Chess');
  await expect(page.getByRole('heading', { name: 'Cookies and browser storage' })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Terms of Service', exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { name: '3. Fair play' })).toBeVisible();
  // Both pages are prerendered, so a direct visit works without the application booting first.
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('loads unknown URLs as a useful not-found page', async ({ page }) => {
  await page.goto('/unknown-page');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Return home', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Play chess', exact: true })).toBeVisible();
});

test('announces invalid registration values next to their fields', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Username', { exact: true }).fill('invalid name');
  await page.getByLabel('Email address', { exact: true }).fill('bad-email');
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByLabel('Confirm password', { exact: true }).fill('different');
  await expect(page.getByText('Enter a valid username.', { exact: true })).toBeVisible();
  await expect(page.getByText('Enter a valid email address.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Enter the same password in both fields.', { exact: true }),
  ).toBeVisible();
});
