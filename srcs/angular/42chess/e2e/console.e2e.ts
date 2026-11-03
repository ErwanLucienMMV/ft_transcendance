import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

/** Pages anyone can open; the address of a missing item must fail politely too. */
const PUBLIC_PAGES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/board',
  '/puzzle',
  '/puzzle/archive',
  '/leaderboard',
  '/progression',
  '/live',
  '/status',
  '/rules',
  '/design',
  '/privacy',
  '/terms',
  '/players/not-an-id',
  '/replay/not-an-id',
  '/does-not-exist',
];
/** Pages of the signed-in player. */
const ACCOUNT_PAGES = ['/play', '/history', '/friends', '/messages', '/settings', '/session'];

/** Opens each page and returns what the console and the page reported as errors. */
async function visit(page: Page, paths: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`${page.url()}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`${page.url()}: ${message.text()}`);
  });
  for (const path of paths) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    // Late requests (lists, presence) report their errors after the first paint.
    await page.waitForLoadState('networkidle');
  }
  return problems;
}

test('every public page opens without a console error, and has one h1', async ({ page }) => {
  expect(await visit(page, PUBLIC_PAGES)).toEqual([]);
  for (const path of ['/', '/design', '/live'])
    await page.goto(path).then(() => expect(page.locator('h1')).toHaveCount(1));
});

test('every account page opens without a console error', async ({ browser, request }) => {
  const username = await verifiedAccount(request);
  const page = await signedIn(browser, username);
  const own = await page.getByRole('link', { name: username }).first().getAttribute('href');
  expect(await visit(page, [...ACCOUNT_PAGES, ...PUBLIC_PAGES, own!])).toEqual([]);
});
