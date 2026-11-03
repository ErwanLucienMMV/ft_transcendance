import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

/** The language list of the footer: its label changes with the language, its role does not. */
const languageSelect = (page: Page) => page.getByRole('contentinfo').getByRole('combobox');

test('switches the whole site from the footer and keeps the choice after a reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Every move');

  await languageSelect(page).selectOption('fr');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chaque coup');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();

  // A prerendered page in English becomes French as soon as the application starts.
  await page.goto('/privacy');
  await expect(
    page.getByRole('heading', { name: 'Politique de confidentialité', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Politique de confidentialité | 42 Chess');
  await expect(
    page.getByRole('heading', { name: 'Cookies et stockage du navigateur' }),
  ).toBeVisible();
  await expect(page.locator('time')).toHaveText('2 novembre 2026');

  await languageSelect(page).selectOption('es');
  await expect(
    page.getByRole('heading', { name: 'Política de privacidad', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Quién puede verlos' })).toBeVisible();
  await expect(languageSelect(page)).toHaveValue('es');

  await languageSelect(page).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});

test.describe('on a first visit', () => {
  test.use({ locale: 'es-ES' });

  test('follows the languages of the browser', async ({ page }) => {
    await page.goto('/login');
    await expect(
      page.getByRole('heading', { name: 'Bienvenido de nuevo', exact: true }),
    ).toBeVisible();
    await expect(languageSelect(page)).toHaveValue('es');
  });
});

test('remembers the language of an account on another browser', async ({ browser, request }) => {
  const username = await verifiedAccount(request);
  const first = await signedIn(browser, username);
  const saved = first.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/users/me') && response.request().method() === 'PATCH',
  );
  await languageSelect(first).selectOption('fr');
  expect((await saved).ok()).toBe(true);

  const second = await signedIn(browser, username);
  await second.goto('/settings');
  await expect(second.getByRole('heading', { name: 'Réglages', exact: true })).toBeVisible();
  await expect(languageSelect(second)).toHaveValue('fr');
  await Promise.all([first.context().close(), second.context().close()]);
});
