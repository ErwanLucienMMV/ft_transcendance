import { expect, Page, test } from '@playwright/test';
import { signedIn, verifiedAccount } from './players';

/**
 * What goes wrong in the header at the current width: two links or buttons on top of each
 * other, one cut by the edge of the header, or the account pushed under the brand onto a third
 * row. A section cut by the scrolling strip of the two-row layout only needs scrolling.
 */
function headerProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const row = document.querySelector('.header-inner') as HTMLElement;
    const nav = document.querySelector('.main-nav') as HTMLElement;
    const strip = getComputedStyle(nav).overflowX !== 'visible';
    const bounds = row.getBoundingClientRect();
    const navBounds = nav.getBoundingClientRect();
    const items = [
      ...row.querySelectorAll<HTMLElement>('.brand, .main-nav > a, .account > *'),
    ].flatMap((element) => {
      const box = element.getBoundingClientRect();
      const inStrip = strip && nav.contains(element);
      const left = inStrip ? Math.max(box.left, navBounds.left) : box.left;
      const right = inStrip ? Math.min(box.right, navBounds.right) : box.right;
      const name = element.textContent?.trim() || element.className;
      return right - left > 0.5 && box.height > 0
        ? [{ name, left, right, top: box.top, bottom: box.bottom }]
        : [];
    });
    const problems: string[] = [];
    if (!strip && nav.scrollWidth > nav.clientWidth + 1) problems.push('sections cut off');
    const brand = (row.querySelector('.brand') as HTMLElement).getBoundingClientRect();
    const account = (row.querySelector('.account') as HTMLElement).getBoundingClientRect();
    if (account.top >= brand.bottom) problems.push('account under the brand');
    items.forEach((a, index) => {
      if (a.left < bounds.left - 0.5 || a.right > bounds.right + 0.5)
        problems.push(`${a.name} outside the header`);
      for (const b of items.slice(index + 1)) {
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 0.5 && height > 0.5) problems.push(`${a.name} over ${b.name}`);
      }
    });
    return problems;
  });
}

/** Narrows the window step by step and collects the widths where the header goes wrong. */
async function sweep(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (let width = 1400; width >= 320; width -= 10) {
    await page.setViewportSize({ width, height: 800 });
    // Two frames: the header measures itself once the new width is laid out.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const problems = await headerProblems(page);
    if (problems.length) found.push(`${width}px: ${problems.join(', ')}`);
  }
  return found;
}

const languageSelect = (page: Page) => page.getByRole('contentinfo').getByRole('combobox');

test('keeps the header readable at every width for visitors, in English and French', async ({
  page,
}) => {
  await page.goto('/');
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  expect(await sweep(page)).toEqual([]);

  await page.setViewportSize({ width: 1280, height: 800 });
  await languageSelect(page).selectOption('fr');
  await expect(header.getByRole('link', { name: 'Se connecter', exact: true })).toBeVisible();
  expect(await sweep(page)).toEqual([]);
});

test('keeps the header readable at every width for a signed-in player in French', async ({
  browser,
  request,
}) => {
  const page = await signedIn(browser, await verifiedAccount(request));
  await languageSelect(page).selectOption('fr');
  const header = page.getByRole('banner');
  await expect(header.getByRole('button', { name: 'Se déconnecter', exact: true })).toBeVisible();
  expect(await sweep(page)).toEqual([]);

  // Wide enough for one row, the sections stay beside the account, without the name.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(header).toHaveAttribute('data-layout', 'compact');
  await expect(header.getByRole('link', { name: 'Messages', exact: true })).toBeInViewport();
  // On a phone, they move under it and every one of them can be reached.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(header).toHaveAttribute('data-layout', 'stacked');
  await header.getByRole('link', { name: 'Messages', exact: true }).click();
  await expect(page).toHaveURL(/\/messages$/);
  await page.close();
});
