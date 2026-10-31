import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function openProfile(page: Page, username: string): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Friends' }).click();
  await page.getByRole('searchbox').fill(username);
  await page.getByRole('button', { name: 'Search' }).click();
  await page
    .getByRole('list', { name: 'Search results' })
    .getByRole('link', { name: username })
    .click();
}

test('two players exchange private messages live, and an offline player reads them later', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const aliceName = await verifiedAccount(request);
  const bobName = await verifiedAccount(request);
  const carolName = await verifiedAccount(request);
  const alice = await signedIn(browser, aliceName);
  const bob = await signedIn(browser, bobName);
  for (const page of [alice, bob])
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  // Alice starts the conversation from Bob's profile; no friendship is needed.
  await openProfile(alice, bobName);
  await alice.getByRole('link', { name: 'Message', exact: true }).click();
  await expect(alice).toHaveURL(/\/messages\/[0-9a-f-]{36}$/);
  const aliceLog = alice.getByRole('log', { name: `Messages with ${bobName}` });
  await expect(aliceLog).toContainText(`No message yet. Say hello to ${bobName}.`);
  await alice.getByLabel(`Message ${bobName}`).fill('Hello Bob 👋');
  await alice.getByRole('button', { name: 'Send' }).click();
  await expect(aliceLog.getByRole('listitem')).toHaveText([/Hello Bob 👋/]);
  await expect(alice.getByLabel(`Message ${bobName}`)).toHaveValue('');

  // Bob already has the page open: the conversation appears with one unread message.
  await bob.getByRole('navigation').getByRole('link', { name: 'Messages' }).click();
  const inbox = bob.getByRole('list', { name: 'Conversations' });
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(inbox).toContainText(aliceName);
  await expect(inbox).toContainText('Hello Bob 👋');
  await expect(inbox.getByLabel('1 unread')).toBeVisible();
  await inbox.getByRole('link', { name: new RegExp(aliceName) }).click();
  const bobLog = bob.getByRole('log', { name: `Messages with ${aliceName}` });
  await expect(bobLog.getByRole('listitem')).toHaveText([/Hello Bob 👋/]);

  // Bob replies with Enter; Alice sees it without reloading, and Shift+Enter keeps a new line.
  const reply = bob.getByLabel(`Message ${aliceName}`);
  await reply.fill('Hi Alice');
  await reply.press('Shift+Enter');
  await reply.pressSequentially('rematch?');
  await reply.press('Enter');
  await expect(aliceLog.getByRole('listitem')).toHaveCount(2);
  await expect(aliceLog.getByRole('listitem').nth(1)).toContainText('Hi Alice\nrematch?');
  await expect(bobLog.getByRole('listitem')).toHaveCount(2);

  // A message over 2000 characters cannot be sent.
  await reply.fill('x'.repeat(2001));
  await expect(bob.getByRole('button', { name: 'Send' })).toBeDisabled();
  await expect(bob.getByText('A message can have at most 2000 characters.')).toBeVisible();

  // Carol has never signed in: the page says she is offline, and the message waits for her.
  await openProfile(alice, carolName);
  await alice.getByRole('link', { name: 'Message', exact: true }).click();
  await expect(alice.getByText(`${carolName} is offline.`)).toBeVisible();
  await alice.getByLabel(`Message ${carolName}`).fill('Are you there?');
  await alice.getByRole('button', { name: 'Send' }).click();
  await expect(alice.getByRole('log', { name: `Messages with ${carolName}` })).toContainText(
    'Are you there?',
  );
  const carol = await signedIn(browser, carolName);
  await carol.getByRole('navigation').getByRole('link', { name: 'Messages' }).click();
  await carol
    .getByRole('list', { name: 'Conversations' })
    .getByRole('link', { name: new RegExp(aliceName) })
    .click();
  await expect(carol.getByRole('log', { name: `Messages with ${aliceName}` })).toContainText(
    'Are you there?',
  );
  expect(errors).toEqual([]);
});
