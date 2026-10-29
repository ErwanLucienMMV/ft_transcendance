import { expect, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

test('plays against the bot from either side', async ({ browser, request }) => {
  const errors: string[] = [];
  const page = await signedIn(browser, await verifiedAccount(request));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  const headline = page.locator('#game-title');

  await page.goto('/play');
  await page.getByText('Medium', { exact: true }).click();
  await page.getByText('White', { exact: true }).click();
  await page.getByRole('button', { name: 'Play the bot' }).click();
  await expect(page).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(headline).toHaveText('Your turn');
  await expect(page.locator('[data-seat="top"] .player')).toHaveText('Computer · Medium');
  await expect(page.getByRole('button', { name: 'Offer draw' })).toHaveCount(0);
  await page.locator('[data-square="e2"]').click();
  await page.locator('[data-square="e4"]').click();
  await expect(page.locator('.move-list li')).toHaveCount(1);
  await expect(page.locator('.move-list li span').nth(1)).not.toHaveText('');
  await expect(headline).toHaveText('Your turn');
  await page.getByRole('button', { name: 'Resign' }).click();
  await page.getByRole('button', { name: 'Confirm resignation' }).click();
  await expect(headline).toHaveText('You lost by resignation');

  // One active bot game at a time: the first one is finished, so a second one may start.
  await page.getByRole('link', { name: 'New game' }).click();
  await page.getByText('Black', { exact: true }).click();
  await page.getByRole('button', { name: 'Play the bot' }).click();
  await expect(page).toHaveURL(/\/game\//);
  await expect(page.locator('.square').first()).toHaveAttribute('data-square', 'h1');
  await expect(page.locator('.move-list li')).toHaveCount(1);
  await expect(headline).toHaveText('Your turn');

  // Only the finished game is in the history; it opens as a replay.
  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  const games = page.locator('.games .game');
  await expect(games).toHaveCount(1);
  await expect(games.first().locator('.outcome')).toHaveText('Lost');
  await expect(games.first()).toContainText('vs Computer · Medium');
  await expect(games.first()).toContainText('White · by resignation · 10 + 0 · 1 move');
  await games.first().click();
  await expect(page).toHaveURL(/\/replay\//);
  await expect(page.locator('#replay-title')).toHaveText('You lost by resignation');
  await expect(page.locator('.position')).toHaveText('Move 2 / 2');
  expect(errors).toEqual([]);
});
