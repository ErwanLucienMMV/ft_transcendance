import { expect, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

// The solution never reaches the browser, so the test plays any legal move and checks
// that the server judged it and kept the attempt across a reload.
test('shows the daily puzzle and checks a move on the server', async ({ browser, request }) => {
  const errors: string[] = [];
  const anonymous = await (await browser.newContext()).newPage();
  await anonymous.goto('/puzzle');
  await expect(anonymous.locator('#puzzle-title')).toHaveText(/^Find the best move for/);
  await expect(anonymous.locator('.square:not([disabled])')).toHaveCount(0);
  await expect(anonymous.getByRole('main').getByRole('link', { name: 'Sign in' })).toBeVisible();

  const page = await signedIn(browser, await verifiedAccount(request));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.getByRole('navigation').getByRole('link', { name: 'Puzzle', exact: true }).click();
  const title = page.locator('#puzzle-title');
  await expect(title).toHaveText(/^Find the best move for/);
  // Read the targets only once the board shows the clicked piece as selected: counting
  // right after the click can see the previous piece's targets and click a stale one.
  const pieces = page.locator('.square[draggable="true"]');
  const targets = page.locator('.square.target');
  for (let index = 0; index < (await pieces.count()); index++) {
    const piece = pieces.nth(index);
    await piece.click();
    await expect(piece).toHaveAttribute('aria-pressed', 'true');
    if (await targets.count()) break;
  }
  await targets.first().click();
  await expect(title).toHaveText(
    /^(Correct! Keep going\.|Not the best move\. Try again\.|Puzzle solved!)$/,
  );
  const position = await page.locator('.square svg').count();
  await page.reload();
  await expect(title).toHaveText(/^(Find the best move for (White|Black)\.|Puzzle solved!)$/);
  await expect(page.locator('.square svg')).toHaveCount(position);
  expect(errors).toEqual([]);
});
