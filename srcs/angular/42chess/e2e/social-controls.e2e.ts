import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function openProfile(page: Page, username: string): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Friends' }).click();
  const result = page
    .getByRole('list', { name: 'Search results' })
    .getByRole('link', { name: username });
  await expect(async () => {
    await page.getByRole('searchbox').fill(username);
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(result).toBeVisible({ timeout: 1000 });
  }).toPass();
  await result.click();
  await expect(page.getByRole('heading', { name: username, level: 2 })).toBeVisible();
}

async function writeTo(page: Page, username: string): Promise<void> {
  await openProfile(page, username);
  await page.getByRole('link', { name: 'Message', exact: true }).click();
  await expect(page.getByRole('log', { name: `Messages with ${username}` })).toBeVisible();
}

async function send(page: Page, username: string, text: string): Promise<void> {
  await page.getByLabel(`Message ${username}`).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

test('shows read receipts and typing, and challenges from the conversation', async ({
  browser,
  request,
}) => {
  const aliceName = await verifiedAccount(request);
  const bobName = await verifiedAccount(request);
  const alice = await signedIn(browser, aliceName);
  const bob = await signedIn(browser, bobName);

  await writeTo(alice, bobName);
  const aliceLog = alice.getByRole('log', { name: `Messages with ${bobName}` });
  await send(alice, bobName, 'Ready for a game?');
  await expect(aliceLog.getByRole('listitem')).toHaveCount(1);
  await expect(aliceLog.locator('.receipt')).toHaveText('Sent');

  // Bob opens the conversation: Alice sees it read, and his unread count is gone.
  await bob.getByRole('navigation').getByRole('link', { name: 'Messages' }).click();
  const inbox = bob.getByRole('list', { name: 'Conversations' });
  await expect(inbox.getByLabel('1 unread')).toBeVisible();
  await inbox.getByRole('link', { name: new RegExp(aliceName) }).click();
  await expect(aliceLog.locator('.receipt')).toContainText('Read');
  await expect(inbox.getByLabel('1 unread')).toHaveCount(0);

  // Bob starts typing: Alice sees it.
  await bob.getByLabel(`Message ${aliceName}`).pressSequentially('Sure');
  await expect(alice.getByText(`${bobName} is typing…`)).toBeVisible();

  // Alice challenges from the conversation; Bob gets a notice and joins.
  await alice.getByRole('button', { name: 'Challenge', exact: true }).click();
  await expect(alice).toHaveURL(/\/game\/[0-9a-f-]{36}$/);
  const gameUrl = new URL(alice.url()).pathname;
  await expect(bob.getByText(`${aliceName} challenges you to a 10 + 0 game.`)).toBeVisible();
  await bob.locator('app-social-notices').getByRole('link', { name: 'Open the game' }).click();
  await expect(bob).toHaveURL(new RegExp(`${gameUrl}$`));
});

test('blocks a player, lists them in settings, and lets only friends write', async ({
  browser,
  request,
}) => {
  const aliceName = await verifiedAccount(request);
  const bobName = await verifiedAccount(request);
  const alice = await signedIn(browser, aliceName);
  const bob = await signedIn(browser, bobName);

  // Alice blocks Bob from his profile, after a confirmation.
  await openProfile(alice, bobName);
  await alice.getByRole('button', { name: 'Block player' }).click();
  await expect(alice.getByText('They are not told.')).toBeVisible();
  await alice.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(alice.getByText('You blocked this player.')).toBeVisible();
  await expect(alice.getByRole('button', { name: 'Add friend' })).toHaveCount(0);

  // Bob can no longer write to her.
  await writeTo(bob, aliceName);
  await send(bob, aliceName, 'Hello?');
  await expect(bob.locator('.composer [role="alert"]')).toContainText(
    'You cannot send messages to this player. Your message was not sent.',
  );

  // Alice finds Bob under Privacy and unblocks him.
  await alice.getByRole('link', { name: 'Settings', exact: true }).click();
  const blocked = alice.getByRole('list', { name: 'Blocked players' });
  await expect(blocked).toContainText(bobName);
  await alice.getByRole('button', { name: `Unblock ${bobName}` }).click();
  await expect(alice.getByText('You have not blocked anyone.')).toBeVisible();

  // Then she lets only friends write: Bob is not one.
  await alice.getByLabel('Only my friends can message or challenge me').check();
  await expect(
    alice.getByText('Only your friends can message or challenge you now.'),
  ).toBeVisible();
  await send(bob, aliceName, 'And now?');
  await expect(bob.locator('.composer [role="alert"]')).toContainText(
    'only lets friends send messages to them',
  );

  // Back to everyone: the message goes through.
  await alice.reload();
  const toggle = alice.getByLabel('Only my friends can message or challenge me');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(alice.getByText('Every player can message or challenge you now.')).toBeVisible();
  await send(bob, aliceName, 'Third try');
  await expect(
    bob.getByRole('log', { name: `Messages with ${aliceName}` }).getByRole('listitem'),
  ).toHaveCount(1);
});
