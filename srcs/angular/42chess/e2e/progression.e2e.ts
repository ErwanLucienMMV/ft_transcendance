import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function move(page: Page, from: string, to: string): Promise<void> {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

test('a rated win earns XP, achievements and a rank, announced live', async ({
  browser,
  request,
}) => {
  const host = await signedIn(browser, await verifiedAccount(request));
  const guest = await signedIn(browser, await verifiedAccount(request));
  await host.getByRole('navigation').getByRole('link', { name: 'Play', exact: true }).click();
  await host.getByText('5 + 0').click();
  await host.getByLabel('Rated game: the result changes both Elo ratings').check();
  await host.getByRole('button', { name: 'Create game' }).click();
  await expect(host).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  const link = await host.getByLabel('Game link').inputValue();
  await guest.goto(new URL(link).pathname);
  const headline = (page: Page) => page.locator('#game-title');
  await expect(headline(host)).not.toHaveText('Waiting for an opponent');
  const hostWhite = (await headline(host).textContent()) === 'Your turn';
  const [white, black] = hostWhite ? [host, guest] : [guest, host];

  // Fool's mate: black wins after two moves each.
  const line: [Page, string, string][] = [
    [white, 'f2', 'f3'],
    [black, 'e7', 'e5'],
    [white, 'g2', 'g4'],
    [black, 'd8', 'h4'],
  ];
  for (const [page, from, to] of line) {
    await expect(headline(page)).toHaveText('Your turn');
    await move(page, from, to);
  }
  await expect(headline(black)).toHaveText('You won by checkmate');

  const notices = black.locator('app-social-notices');
  await expect(
    notices.getByText('First victory: Win a game against another player.'),
  ).toBeVisible();
  await expect(notices.getByText(/^Opening move:/)).toBeVisible();
  await notices
    .locator('.notice', { hasText: 'First victory' })
    .getByRole('link', { name: 'See your achievements' })
    .click();
  await expect(black).toHaveURL(/\/players\/[0-9a-f-]{36}#achievements$/);
  await expect(black.locator('#achievements h3')).toContainText('2 of 14 unlocked');
  // 30 for the win, 10 and 20 for the two achievements.
  await expect(black.locator('app-level-bar')).toContainText('60 / 100 XP');
  await expect(black.locator('.results tbody tr').first()).toContainText('Rated');
  await expect(black.locator('app-elo-chart svg')).toHaveAttribute(
    'aria-label',
    /^Rating over the last 1 rated game: from 1200 to 1216/,
  );

  await black.locator('.stats a').click();
  await expect(black).toHaveURL(/\/leaderboard\?rank=\d+$/);
  await expect(black.locator('tr.me')).toBeVisible();
  await expect(black.locator('tr.me .elo')).toHaveText('1216');
  await expect(black.locator('.my-rank strong')).toHaveText(/^#\d+$/);

  await black.getByRole('link', { name: 'How ratings, XP and levels work' }).click();
  await expect(black.getByRole('heading', { name: 'How progression works' })).toBeVisible();
  await expect(black.getByRole('row', { name: /against a player/ })).toContainText('30 · 15 · 10');
});

test('the daily puzzle gives a hint, shows the solution and keeps the archive', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const page = await signedIn(browser, await verifiedAccount(request));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto('/puzzle');
  const title = page.locator('#puzzle-title');
  await expect(title).toHaveText(/^Find the best move for/);
  await expect(page.locator('.note')).toContainText('3 wrong moves left.');

  await page.getByRole('button', { name: 'Hint', exact: true }).click();
  await expect(page.locator('.hint-note')).toHaveText(/^Hint: move the piece on [a-h][1-8]\.$/);
  const square = (await page.locator('.hint-note').textContent())!.match(/[a-h][1-8]/)![0];
  await expect(page.locator(`[data-square="${square}"]`)).toHaveClass(/\bhint\b/);
  await expect(page.getByRole('button', { name: 'Hint', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Show the solution' }).click();
  await expect(title).toHaveText('Solution shown.');
  const replay = page.getByRole('navigation', { name: 'Solution' });
  const total = Number((await replay.locator('span').textContent())!.match(/of (\d+)/)![1]);
  await expect(replay.locator('span')).toHaveText(`Move ${total} of ${total}`);
  await replay.getByRole('button', { name: 'Previous move' }).click();
  await expect(replay.locator('span')).toHaveText(`Move ${total - 1} of ${total}`);
  await expect(page.locator('.square:not([disabled])')).toHaveCount(0);

  // The attempt is over on every device, and a new one is practice.
  await page.reload();
  await expect(title).toHaveText('Solution shown.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(title).toHaveText(/^Find the best move for/);
  await expect(page.locator('.note')).toContainText('Practice attempt: it earns no XP.');

  await page.getByRole('link', { name: 'Earlier puzzles' }).click();
  await expect(page.getByRole('heading', { name: 'Earlier puzzles' })).toBeVisible();
  const first = page.locator('.puzzles a').first();
  if (await first.count()) {
    await first.click();
    await expect(page).toHaveURL(/\/puzzle\/[0-9a-f-]{36}$/);
    await expect(page.locator('.eyebrow').first()).toHaveText('Puzzle archive');
    await expect(title).toHaveText(
      /^(Find the best move for|Puzzle solved!|Out of tries\.|Solution shown\.)/,
    );
  } else {
    await expect(page.getByText('No earlier puzzle yet.')).toBeVisible();
  }
  expect(errors).toEqual([]);
});
