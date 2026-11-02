import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

test('a third user finds a live game, watches it move by move and leaves', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const host = await signedIn(browser, await verifiedAccount(request));
  const guestName = await verifiedAccount(request);
  const guest = await signedIn(browser, guestName);
  const viewer = await signedIn(browser, await verifiedAccount(request));
  for (const page of [host, guest, viewer])
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  await host.goto('/play');
  await host.getByRole('button', { name: 'Create game' }).click();
  await expect(host).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  const path = new URL(await host.getByLabel('Game link').inputValue()).pathname;
  await guest.goto(path);
  const headline = (page: Page) => page.locator('#game-title');
  await expect(headline(host)).not.toHaveText('Waiting for an opponent');
  const hostWhite = (await headline(host).textContent()) === 'Your turn';
  const [white, black] = hostWhite ? [host, guest] : [guest, host];

  await viewer.getByRole('navigation').getByRole('link', { name: 'Live' }).click();
  const row = viewer.locator('.game', { hasText: guestName });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Watch' }).click();
  await expect(viewer.locator('.eyebrow')).toHaveText('Spectating');
  await expect(headline(viewer)).toHaveText('White to move');
  await expect(white.locator('[data-watchers]')).toHaveText('1 spectator watching');
  await expect(viewer.getByRole('button', { name: 'Resign' })).toHaveCount(0);
  await expect(viewer.locator('.square:not([disabled])')).toHaveCount(0);

  await move(white, 'e2', 'e4');
  await expect(viewer.locator('.move-list li').first()).toContainText('e4');
  await expect(headline(viewer)).toHaveText('Black to move');
  await expect(black.locator('[data-watchers]')).toHaveText('1 spectator watching');

  await viewer.getByRole('button', { name: 'Stop watching' }).click();
  await expect(viewer).toHaveURL(/\/live$/);
  await expect(white.locator('[data-watchers]')).toHaveCount(0);

  // Opening the game link without a seat also ends up watching it.
  await viewer.goto(path);
  await expect(viewer.locator('.eyebrow')).toHaveText('Spectating');
  await expect(viewer.locator('.move-list li').first()).toContainText('e4');
  await black.getByRole('button', { name: 'Resign' }).click();
  await black.getByRole('button', { name: 'Confirm resignation' }).click();
  await expect(headline(viewer)).toHaveText('White wins by resignation');
  expect(errors).toEqual([]);
});
