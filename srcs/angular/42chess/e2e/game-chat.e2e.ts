import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function befriend(alice: Page, bob: Page, bobName: string): Promise<void> {
  await alice.getByRole('navigation').getByRole('link', { name: 'Friends' }).click();
  const result = alice
    .getByRole('list', { name: 'Search results' })
    .getByRole('link', { name: bobName });
  // The page resets its search box while it opens, which can erase text typed that early.
  await expect(async () => {
    await alice.getByRole('searchbox').fill(bobName);
    await alice.getByRole('button', { name: 'Search' }).click();
    await expect(result).toBeVisible({ timeout: 1000 });
  }).toPass();
  await result.click();
  await alice.getByRole('button', { name: 'Add friend' }).click();
  await expect(alice.getByRole('status')).toHaveText('Friend request sent.');
  await bob.getByRole('navigation').getByRole('link', { name: 'Friends' }).click();
  await bob
    .getByRole('list', { name: 'Friend requests' })
    .getByRole('button', { name: 'Accept' })
    .click();
  await expect(bob.getByRole('list', { name: 'Friends' }).getByRole('listitem')).toHaveCount(1);
}

test('a friend is challenged by message, and players and a spectator chat until the end', async ({
  browser,
  request,
}) => {
  const aliceName = await verifiedAccount(request);
  const bobName = await verifiedAccount(request);
  const carolName = await verifiedAccount(request);
  const alice = await signedIn(browser, aliceName);
  const bob = await signedIn(browser, bobName);
  const carol = await signedIn(browser, carolName);
  const errors: string[] = [];
  for (const page of [alice, bob, carol])
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await befriend(alice, bob, bobName);

  // Bob challenges Alice from his friend list and waits on the game page.
  await bob.getByRole('button', { name: `Challenge ${aliceName}` }).click();
  await expect(bob).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  await expect(bob.locator('#game-title')).toHaveText('Waiting for an opponent');

  // The seat is reserved for Alice: nobody else takes it with the link.
  await carol.goto(new URL(bob.url()).pathname);
  await expect(carol.getByText('This game is reserved for the invited player.')).toBeVisible();
  await expect(bob.locator('#game-title')).toHaveText('Waiting for an opponent');

  // Alice finds the challenge in her messages and opens it: the game starts.
  await alice.getByRole('navigation').getByRole('link', { name: 'Messages' }).click();
  await alice
    .getByRole('list', { name: 'Conversations' })
    .getByRole('link', { name: new RegExp(bobName) })
    .click();
  await expect(alice.getByRole('log')).toContainText('I challenge you to a game');
  await alice.getByRole('link', { name: 'Open the game' }).click();
  await expect(alice).toHaveURL(bob.url());
  await expect(bob.locator('#game-title')).not.toHaveText('Waiting for an opponent');

  // Everyone in the room reads every message, whoever wrote it.
  const chat = (page: Page) => page.getByRole('log', { name: 'Game chat' });
  const write = async (page: Page, text: string) => {
    const box = page.getByLabel('Message the game');
    await box.fill(text);
    await box.press('Enter');
    await expect(chat(page)).toContainText(text);
    await expect(box).toHaveValue('');
  };
  await write(alice, 'Good luck 👋');
  await expect(chat(bob)).toContainText('Good luck 👋');
  await expect(chat(bob)).toContainText(aliceName);

  await carol.goto(new URL(bob.url()).pathname);
  await expect(carol.locator('.eyebrow')).toHaveText('Spectating');
  await expect(chat(carol)).toContainText('Good luck 👋');
  await write(carol, 'Have fun');
  await expect(chat(alice)).toContainText('Have fun');

  // A reload reads the history again.
  await bob.reload();
  await expect(chat(bob).getByRole('listitem')).toHaveCount(2);

  // Too long a message cannot be sent.
  await alice.getByLabel('Message the game').fill('x'.repeat(2001));
  await expect(alice.getByText('A message can have at most 2000 characters.')).toBeVisible();
  await alice.getByLabel('Message the game').fill('');

  // The chat closes with the game, and what was said stays.
  await bob.getByRole('button', { name: 'Resign' }).click();
  await bob.getByRole('button', { name: 'Confirm resignation' }).click();
  for (const page of [alice, bob, carol]) {
    await expect(page.getByText('The chat closed when the game ended.')).toBeVisible();
    await expect(page.getByLabel('Message the game')).toHaveCount(0);
    await expect(chat(page).getByRole('listitem')).toHaveCount(2);
  }
  expect(errors).toEqual([]);
});
