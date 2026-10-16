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
