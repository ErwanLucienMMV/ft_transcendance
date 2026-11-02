import { createHmac } from 'node:crypto';
import { expect, Page, test } from '@playwright/test';
import { PASSWORD, signedIn, verifiedAccount } from './players';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
  'base64',
);

/** The current authenticator code for a base32 secret (RFC 6238, 30 s, 6 digits). */
function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.replace(/=+$/, '').toUpperCase())
    bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0xf;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function signIn(page: Page, login: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username or email address').fill(login);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

test('changes the picture, the username and the password from the settings page', async ({
  browser,
  request,
}) => {
  const username = await verifiedAccount(request);
  const page = await signedIn(browser, username);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  // Picture: a preview first, then the saved picture everywhere, including the header.
  await expect(page.locator('.account-link app-avatar')).toHaveText(username[0].toUpperCase());
  await page.getByText('Choose a picture').click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByAltText('Preview of your new picture')).toBeVisible();
  await page.getByRole('button', { name: 'Save picture' }).click();
  await expect(page.getByText('Your new picture is saved.')).toBeVisible();
  const headerPicture = page.locator('.account-link app-avatar img');
  await expect(headerPicture).toHaveAttribute('src', /\/api\/v1\/avatars\/[0-9a-f-]+\.png$/);
  expect(await headerPicture.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.getByRole('button', { name: 'Remove picture' }).click();
  await expect(page.getByText('Your picture was removed.')).toBeVisible();
  await expect(headerPicture).toHaveCount(0);

  // Username.
  const renamed = `r${username.slice(1)}`;
  await page.getByLabel('Username').fill(renamed);
  await page.getByRole('button', { name: 'Save username' }).click();
  await expect(page.getByText(`Your username is now ${renamed}.`)).toBeVisible();
  await expect(page.locator('.account-name')).toHaveText(renamed);

  // Password: the next sign-in needs the new one.
  const newPassword = 'a fresh password 42';
  await page.getByLabel('Current password').fill(PASSWORD);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm the new password').fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your password was changed.')).toBeVisible();
  await signOut(page);
  await signIn(page, renamed, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('Incorrect');
  await signIn(page, renamed, newPassword);
  await expect(page).toHaveURL(/\/session$/);
});

test('resets a forgotten password from the emailed link', async ({ page, request }) => {
  const username = await verifiedAccount(request);
  const email = `${username}@example.com`;
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('status')).toContainText('a link is on its way');

  const mail = await request.get(
    `${process.env['TEST_MAIL_URL']}/_test/message?to=${encodeURIComponent(email)}&kind=password-reset`,
  );
  const { token } = (await mail.json()) as { token: string };
  const newPassword = 'reset password 42!';
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm the new password').fill(newPassword);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password was changed');

  // The link works once.
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('New password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm the new password').fill(newPassword);
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page.getByRole('alert')).toContainText('expired');

  await signIn(page, username, newPassword);
  await expect(page).toHaveURL(/\/session$/);
});

test('turns on two-factor authentication and signs in with a recovery code', async ({
  browser,
  request,
}) => {
  const username = await verifiedAccount(request);
  const page = await signedIn(browser, username);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
  await expect(page.getByAltText(/QR code/)).toBeVisible();
  await page.getByText('Cannot scan it?').click();
  const secret = (await page.locator('.secret').textContent())!.trim();
  await page.getByLabel('Enter the 6-digit code the app shows').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  const codes = page.locator('.codes code');
  await expect(codes).toHaveCount(10);
  const recovery = (await codes.first().textContent())!.trim();
  await page.getByRole('button', { name: 'I saved them' }).click();
  await expect(page.getByText('10 recovery codes left.')).toBeVisible();

  await signOut(page);
  await signIn(page, username, PASSWORD);
  await expect(page).toHaveURL(/\/two-factor/);
  await page.getByLabel('Authenticator code or recovery code').fill(recovery);
  await page.getByRole('button', { name: 'Verify code' }).click();
  await expect(page).toHaveURL(/\/session$/);
  await page.goto('/settings');
  await expect(page.getByText('9 recovery codes left.')).toBeVisible();
});

test('downloads the account data, then deletes the account', async ({ browser, request }) => {
  const username = await verifiedAccount(request);
  const page = await signedIn(browser, username);
  await page.goto('/settings');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    new RegExp(`^42chess-${username}-\\d{4}-\\d{2}-\\d{2}\\.json$`),
  );
  await expect(page.getByText('Your data was downloaded.')).toBeVisible();

  await page.getByRole('button', { name: 'Delete my account…' }).click();
  const confirm = page.getByRole('button', { name: 'Delete my account for good' });
  await page.getByLabel(/Type your username/).fill(username);
  await expect(confirm).toBeDisabled();
  await page.locator('#delete-password').fill(PASSWORD);
  await confirm.click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('Your account was deleted');
  await signIn(page, username, PASSWORD);
  await expect(page.getByRole('alert')).toContainText('Incorrect');
});
