import { expect, test } from '@playwright/test';

// The API counts an emoji as one character; native maxlength counts UTF-16 code units.
const emoji = (count: number) => '😀'.repeat(count);
// Longest value the API accepts: 128 characters of three code units each.
const longest = '😀\uFE0F'.repeat(128);

test('pastes and types every password length the API accepts into the sign-in form', async ({
  page,
}) => {
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill(longest);
  await expect(password).toHaveValue(longest);
  await password.fill('');
  await password.pressSequentially(emoji(65));
  await expect(password).toHaveValue(emoji(65));
  await page.getByLabel('Username or email address').fill('Ta2b');
  await password.blur();
  await expect(page.getByText(/Enter your password/)).toHaveCount(0);
});

test('applies the API password bounds to emoji during registration', async ({ page }) => {
  await page.goto('/register');
  const password = page.getByLabel('Password', { exact: true });
  const confirmation = page.getByLabel('Confirm password', { exact: true });
  const error = page.getByText('Enter a password within these limits.', { exact: true });
  await password.fill(emoji(4));
  await confirmation.fill(emoji(4));
  await expect(error).toBeVisible();
  await password.fill(emoji(128));
  await confirmation.pressSequentially(emoji(128).slice(emoji(4).length));
  await expect(password).toHaveValue(emoji(128));
  await expect(confirmation).toHaveValue(emoji(128));
  await expect(error).toHaveCount(0);
  await expect(page.getByText('Enter the same password in both fields.')).toHaveCount(0);
  // Replacing a filled masked field: a native maxlength made Chromium truncate this text.
  await password.fill(emoji(129));
  await expect(password).toHaveValue(emoji(129));
  await expect(error).toBeVisible();
});
