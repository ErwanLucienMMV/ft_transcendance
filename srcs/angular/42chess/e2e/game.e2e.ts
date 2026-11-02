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
  await host.getByRole('button', { name: /^Create a (casual|rated) game$/ }).click();
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
  await expect(black.locator('.overlay.result')).toHaveText('White wins by checkmate');
  await expect(white.locator('.move-list li').last()).toContainText('Qxf7#');

  // The finished game is replayed from the stored moves.
  await white.getByRole('link', { name: 'Replay' }).click();
  await expect(white).toHaveURL(/\/replay\/[0-9a-f-]{36}$/);
  await expect(white.locator('#replay-title')).toHaveText('You won by checkmate');
  await expect(white.locator('.position')).toHaveText('Move 7 / 7');
  await white.getByRole('button', { name: 'Previous move' }).click();
  await expect(white.locator('.position')).toHaveText('Move 6 / 7');
  await expect(white.locator('.overlay.result')).toHaveCount(0);
  await white.getByRole('button', { name: 'e4', exact: true }).click();
  await expect(white.locator('[data-square="f1"] svg')).toHaveCount(1);
  await expect(white.locator('[data-square="e2"] svg')).toHaveCount(0);
  await expect(white.locator('.position')).toHaveText('Move 1 / 7');
  expect(errors).toEqual([]);
});

/** Host creates a game from the play page, guest opens the link; returns [white, black]. */
async function startGame(
  host: Page,
  guest: Page,
  options: { rated?: boolean } = {},
): Promise<[Page, Page]> {
  await host.goto('/play');
  if (options.rated) await host.getByLabel(/Rated game/).check();
  await host.getByRole('button', { name: /^Create a (casual|rated) game$/ }).click();
  await expect(host).toHaveURL(/\/game\//);
  await guest.goto(new URL(await host.getByLabel('Game link').inputValue()).pathname);
  const headline = (page: Page) => page.locator('#game-title');
  await expect(headline(host)).not.toHaveText('Waiting for an opponent');
  await expect(headline(guest)).not.toHaveText('Waiting for an opponent');
  return (await headline(host).textContent()) === 'Your turn' ? [host, guest] : [guest, host];
}

test('a player resigns after declining a draw offer', async ({ browser, request }) => {
  const host = await signedIn(browser, await verifiedAccount(request));
  const guest = await signedIn(browser, await verifiedAccount(request));
  const [white, black] = await startGame(host, guest, { rated: true });
  await expect(white.locator('[data-kind]')).toHaveText('Rated · 10 + 0');
  await move(white, 'e2', 'e4');
  await expect(black.locator('#game-title')).toHaveText('Your turn');
  await move(black, 'e7', 'e5');
  await expect(white.getByRole('button', { name: 'Offer draw' })).toBeVisible();

  await white.getByRole('button', { name: 'Offer draw' }).click();
  await expect(black.getByText('Your opponent offers a draw.')).toBeVisible();
  await black.getByRole('button', { name: 'Decline' }).click();
  await expect(white.getByText('Your draw offer was declined.')).toBeVisible();
  // A refused offer cannot be repeated straight away.
  await expect(white.getByRole('button', { name: 'Offer draw' })).toHaveCount(0);

  await black.getByRole('button', { name: 'Resign' }).click();
  await black.getByRole('button', { name: 'Confirm resignation' }).click();
  await expect(white.locator('#game-title')).toHaveText('You won by resignation');
  await expect(black.locator('#game-title')).toHaveText('You lost by resignation');
  await expect(black.getByRole('link', { name: 'New game' })).toBeVisible();
});

test('a game is aborted before the first moves, and a departure is announced', async ({
  browser,
  request,
}) => {
  const host = await signedIn(browser, await verifiedAccount(request));
  const guest = await signedIn(browser, await verifiedAccount(request));
  let [white, black] = await startGame(host, guest);
  await expect(white.locator('[data-kind]')).toHaveText('Casual · 10 + 0');
  await expect(white.locator('[data-first-move]')).toContainText('to play a first move');
  await expect(white.getByRole('button', { name: 'Resign' })).toHaveCount(0);
  await black.getByRole('button', { name: 'Abort game' }).click();
  await expect(white.locator('#game-title')).toHaveText('Game aborted');
  await expect(black.locator('#game-title')).toHaveText('Game aborted');

  [white, black] = await startGame(host, guest);
  await move(white, 'e2', 'e4');
  await expect(black.locator('#game-title')).toHaveText('Your turn');
  await move(black, 'e7', 'e5');
  await expect(white.locator('#game-title')).toHaveText('Your turn');
  // The opponent closes the game: the other player is told and can wait or claim later.
  await black.goto('/play');
  await expect(white.locator('[data-away]')).toContainText('Your opponent disconnected');
  await black.goBack();
  await expect(white.locator('[data-away]')).toHaveCount(0);
});
