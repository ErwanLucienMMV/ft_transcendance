import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

test('two players create, join and finish a live game by checkmate', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const host = await signedIn(browser, await verifiedAccount(request));
  const guest = await signedIn(browser, await verifiedAccount(request));
  for (const page of [host, guest])
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  await host.getByRole('navigation').getByRole('link', { name: 'Play', exact: true }).click();
  await host.getByText('5 + 0').click();
  await host.getByRole('button', { name: 'Create game' }).click();
  await expect(host).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(host.getByRole('heading', { name: 'Waiting for an opponent' })).toBeVisible();
  const link = await host.getByLabel('Game link').inputValue();

  await guest.goto(new URL(link).pathname);
  const headline = (page: Page) => page.locator('#game-title');
  await expect(headline(guest)).not.toHaveText('Waiting for an opponent');
  await expect(headline(host)).not.toHaveText('Waiting for an opponent');
  const hostWhite = (await headline(host).textContent()) === 'Your turn';
  const [white, black] = hostWhite ? [host, guest] : [guest, host];
  await expect(headline(white)).toHaveText('Your turn');
  await expect(headline(black)).toHaveText("Opponent's turn");
  await expect(black.locator('.square').first()).toHaveAttribute('data-square', 'h1');

  const line: [Page, string, string][] = [
    [white, 'e2', 'e4'],
    [black, 'e7', 'e5'],
    [white, 'f1', 'c4'],
    [black, 'b8', 'c6'],
    [white, 'd1', 'h5'],
    [black, 'g8', 'f6'],
  ];
  for (const [page, from, to] of line) {
    await expect(headline(page)).toHaveText('Your turn');
    await move(page, from, to);
  }
  // A reload drops the socket; the page must rejoin the same game with the full history.
  await black.reload();
  await expect(black.locator('.move-list li')).toHaveCount(3);
  await expect(headline(white)).toHaveText('Your turn');
  await move(white, 'h5', 'f7');

  await expect(headline(white)).toHaveText('You won by checkmate');
  await expect(headline(black)).toHaveText('You lost by checkmate');
  await expect(black.locator('.overlay.result')).toHaveText('White wins · checkmate');
  await expect(white.locator('.move-list li').last()).toContainText('Qxf7#');
  expect(errors).toEqual([]);
});

test('a player resigns after declining a draw offer', async ({ browser, request }) => {
  const host = await signedIn(browser, await verifiedAccount(request));
  const guest = await signedIn(browser, await verifiedAccount(request));
  await host.goto('/play');
  await host.getByRole('button', { name: 'Create game' }).click();
  await expect(host).toHaveURL(/\/game\//);
  await guest.goto(new URL(await host.getByLabel('Game link').inputValue()).pathname);
  await expect(host.getByRole('button', { name: 'Offer draw' })).toBeVisible();

  await host.getByRole('button', { name: 'Offer draw' }).click();
  await expect(guest.getByText('Your opponent offers a draw.')).toBeVisible();
  await guest.getByRole('button', { name: 'Decline' }).click();
  await expect(host.getByText('Your draw offer was declined.')).toBeVisible();

  await guest.getByRole('button', { name: 'Resign' }).click();
  await guest.getByRole('button', { name: 'Confirm resignation' }).click();
  await expect(host.locator('#game-title')).toHaveText('You won by resignation');
  await expect(guest.locator('#game-title')).toHaveText('You lost by resignation');
  await expect(guest.getByRole('link', { name: 'New game' })).toBeVisible();
});
