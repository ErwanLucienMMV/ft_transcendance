import { expect, test } from '@playwright/test';

test('shows the services and the last backup on the status page, from the footer', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('contentinfo')
    .getByRole('navigation', { name: 'Help' })
    .getByRole('link', { name: 'Service status', exact: true })
    .click();
  await expect(page).toHaveURL(/\/status$/);
  await expect(page).toHaveTitle('Service status | 42 Chess');
  await expect(page.getByRole('heading', { name: 'Is 42 Chess working?' })).toBeVisible();

  const services = page.getByRole('region', { name: 'Services' }).getByRole('listitem');
  await expect(services).toHaveCount(5);
  // The browser stack runs the database, the rules engine, the bot and a mail stand-in.
  for (const name of ['Website and API', 'Database', 'Rules engine', 'Computer opponent', 'Email'])
    await expect(services.filter({ hasText: name })).toContainText('Operational');
  await expect(page.getByRole('heading', { name: 'All systems operational' })).toBeVisible();
  // The browser stack has no backup service; a full stack has one.
  await expect(page.getByRole('region', { name: 'Database backups' })).toContainText(
    /No backup has been recorded yet\.|Last backup (less than a minute|\d+ \w+) ago\./,
  );

  await page.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByText(/^Checked at \d{2}:\d{2}:\d{2}$/)).toBeVisible();
  expect(errors).toEqual([]);
});
