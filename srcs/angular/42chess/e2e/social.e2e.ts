import { expect, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

test('finds a player, opens their profile with live presence and the own profile', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const seeker = await verifiedAccount(request);
  const targetName = await verifiedAccount(request);
  const page = await signedIn(browser, seeker);
  const target = await signedIn(browser, targetName);
  for (const tab of [page, target])
    tab.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  await page.getByRole('navigation').getByRole('link', { name: 'Friends' }).click();
  await expect(page).toHaveURL(/\/friends$/);
  await expect(page.getByText('No friends yet.')).toBeVisible();
  await page.getByRole('searchbox').fill(targetName.slice(0, 12).toUpperCase());
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?q=${targetName.slice(0, 12).toUpperCase()}$`));
  const result = page.getByRole('list', { name: 'Search results' }).getByRole('listitem', {
    hasText: targetName,
  });
  // The target's tab keeps its signed-in socket, so the server reports it online.
  await expect(result.locator('app-presence-badge')).toHaveText('Online');

  await result.getByRole('link', { name: targetName }).click();
  await expect(page).toHaveURL(/\/players\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: targetName, level: 2 })).toBeVisible();
  await expect(page.locator('.stats')).toContainText('Elo');
  await expect(page.locator('.stats dd').first()).toHaveText('1200');
  await expect(page.locator('app-presence-badge')).toHaveText('Online');
  await expect(page.getByText('No rated game yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account settings' })).toHaveCount(0);

  await target.getByRole('button', { name: 'Sign out' }).click();
  await expect(target).toHaveURL(/\/login$/);
  await expect(async () => {
    await page.reload();
    await expect(page.locator('app-presence-badge')).toHaveText('Offline', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });

  await page.goto('/session');
  await page.getByRole('link', { name: 'View your profile' }).click();
  await expect(page.getByRole('heading', { name: seeker, level: 2 })).toBeVisible();
  await expect(page.locator('.eyebrow')).toHaveText('Your profile');
  await expect(page.locator('.stats dt')).toHaveText(['Elo', 'Games', 'Won', 'Drawn', 'Lost']);
  await expect(page.getByRole('link', { name: 'Account settings' })).toHaveAttribute(
    'href',
    '/session',
  );
  // Anyone can read a profile, even without an account.
  const anonymous = await (await browser.newContext()).newPage();
  await anonymous.goto(page.url());
  await expect(anonymous.getByRole('heading', { name: seeker, level: 2 })).toBeVisible();
  await anonymous.goto('/players/00000000-0000-4000-8000-000000000000');
  await expect(anonymous.getByRole('alert')).toHaveText('This player does not exist.');
  expect(errors).toEqual([]);
});
