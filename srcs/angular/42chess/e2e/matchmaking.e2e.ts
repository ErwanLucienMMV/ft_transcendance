import { expect, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

test('two players queue with the same time control and land in the same game', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const first = await signedIn(browser, await verifiedAccount(request));
  const second = await signedIn(browser, await verifiedAccount(request));
  for (const page of [first, second])
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  // A search can be cancelled before anyone else arrives.
  await first.goto('/play');
  await first.getByRole('radio', { name: /15 \+ 10/ }).check();
  await first.getByRole('button', { name: 'Find an opponent' }).click();
  await expect(first.getByRole('status')).toContainText('Searching for a 15 + 10 opponent');
  await expect(first.getByRole('button', { name: 'Create game' })).toBeDisabled();
  await first.getByRole('button', { name: 'Cancel search' }).click();
  await expect(first.getByRole('button', { name: 'Find an opponent' })).toBeVisible();

  await first.getByRole('button', { name: 'Find an opponent' }).click();
  await expect(first.getByRole('status')).toContainText('Searching');
  await second.goto('/play');
  await second.getByRole('radio', { name: /15 \+ 10/ }).check();
  await second.getByRole('button', { name: 'Find an opponent' }).click();

  await expect(first).toHaveURL(/\/game\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(second).toHaveURL(first.url(), { timeout: 15_000 });
  const headlines = [first, second].map((page) => page.locator('#game-title'));
  await expect(headlines[0]).not.toHaveText('Waiting for an opponent');
  await expect(headlines[1]).not.toHaveText('Waiting for an opponent');
  // Two distinct colours: exactly one of them has the move.
  const turns = await Promise.all(headlines.map((headline) => headline.textContent()));
  expect(turns.sort()).toEqual(["Opponent's turn", 'Your turn']);

  await first.getByRole('button', { name: 'Resign' }).click();
  await first.getByRole('button', { name: 'Confirm resignation' }).click();
  await expect(second.locator('#game-title')).toContainText('by resignation');
  // A finished match is not reopened when the player comes back to the play page.
  await second.goto('/play');
  await expect(second.getByRole('button', { name: 'Find an opponent' })).toBeVisible();
  await expect(second).toHaveURL(/\/play$/);
  expect(errors).toEqual([]);
});
