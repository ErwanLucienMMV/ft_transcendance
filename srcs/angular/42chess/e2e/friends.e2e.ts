import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

async function openFriends(page: Page): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name: 'Friends' }).click();
  await expect(page).toHaveURL(/\/friends$/);
}

test('sends, accepts and removes a friend, with presence pushed live to the friend list', async ({
  browser,
  request,
}) => {
  const errors: string[] = [];
  const aliceName = await verifiedAccount(request);
  const bobName = await verifiedAccount(request);
  const alice = await signedIn(browser, aliceName);
  const bob = await signedIn(browser, bobName);
  for (const page of [alice, bob])
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  // Alice finds Bob and sends a request from his profile.
  await openFriends(alice);
  await alice.getByRole('searchbox').fill(bobName);
  await alice.getByRole('button', { name: 'Search' }).click();
  await alice
    .getByRole('list', { name: 'Search results' })
    .getByRole('link', { name: bobName })
    .click();
  await alice.getByRole('button', { name: 'Add friend' }).click();
  await expect(alice.getByRole('status')).toHaveText('Friend request sent.');
  // Bob is on another page: a notice tells him, with a link to his requests.
  await expect(bob.getByText(`${aliceName} wants to be your friend.`)).toBeVisible();
  // The profile reads the requests Alice sent, so a reload still knows, and offers to cancel.
  await alice.reload();
  await expect(alice.getByRole('status')).toHaveText('Friend request sent.');
  await expect(alice.getByRole('button', { name: 'Cancel request' })).toBeVisible();

  // Bob sees it in his inbox with Alice's name, and accepts.
  await bob.getByRole('link', { name: 'See the request' }).click();
  await expect(bob).toHaveURL(/\/friends$/);
  await expect(bob.getByText(`${aliceName} wants to be your friend.`)).toHaveCount(0);
  const inbox = bob.getByRole('list', { name: 'Friend requests' });
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(inbox).toContainText(aliceName);
  await inbox.getByRole('button', { name: 'Accept' }).click();
  await expect(bob.getByRole('list', { name: 'Friend requests' })).toHaveCount(0);
  const bobsFriend = bob.getByRole('list', { name: 'Friends' }).getByRole('listitem');
  await expect(bobsFriend).toHaveCount(1);
  await expect(bobsFriend).toContainText(aliceName);
  await expect(bobsFriend.locator('app-presence-badge')).toHaveText('Online');

  // Alice's list shows Bob online; Bob signing out reaches her without a reload.
  await openFriends(alice);
  const alicesFriend = alice.getByRole('list', { name: 'Friends' }).getByRole('listitem');
  await expect(alicesFriend).toContainText(bobName);
  await expect(alicesFriend.locator('app-presence-badge')).toHaveText('Online');
  await bob.getByRole('button', { name: 'Sign out' }).click();
  await expect(alicesFriend.locator('app-presence-badge')).toHaveText('Offline');
  await alicesFriend.getByRole('link', { name: bobName }).click();
  await expect(alice.getByText('You are friends.')).toBeVisible();

  // Removing needs a confirmation.
  await openFriends(alice);
  await alice.getByRole('button', { name: `Remove ${bobName}` }).click();
  await alice.getByRole('button', { name: 'Confirm removal' }).click();
  await expect(alice.getByRole('list', { name: 'Friends' })).toHaveCount(0);
  await expect(alice.getByText('No friends yet.')).toBeVisible();
  expect(errors).toEqual([]);
});
