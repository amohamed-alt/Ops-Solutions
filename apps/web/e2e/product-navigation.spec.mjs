import { expect, test } from '@playwright/test';

const primaryRoutes = [
  ['/dashboard', 'Dashboard'],
  ['/builder', 'Builder'],
  ['/settings/actions', 'Ops Actions'],
  ['/settings/billing', 'Billing & Lifecycle'],
  ['/setup', 'Setup Center']
];

test('launch home renders the current product map and valid entry points', async ({ page }) => {
  const response = await page.goto('/');

  expect(response).not.toBeNull();
  expect(response.status()).toBeLessThan(500);
  await expect(page.getByRole('heading', {
    level: 1,
    name: 'One connected HubSpot revenue intelligence product.'
  })).toBeVisible();
  await expect(page.getByText('Dashboard Engine', { exact: true })).toHaveCount(0);

  for (const [href, label] of primaryRoutes) {
    const link = page.locator(`a[href="${href}"]`).first();
    await expect(link, `${label} should be linked from the launch home`).toBeVisible();
  }
});

test('builder entry point resolves without a broken route', async ({ page }) => {
  await page.goto('/');
  const builderLink = page.locator('a[href="/builder"]').first();
  await expect(builderLink).toBeVisible();

  const navigation = page.waitForResponse((response) => response.request().isNavigationRequest(), {
    timeout: 15_000
  }).catch(() => null);
  await builderLink.click();
  const response = await navigation;
  await page.waitForLoadState('domcontentloaded');

  if (response) expect(response.status()).toBeLessThan(500);
  expect(page.url()).not.toMatch(/\/404(?:\?|$)/);
  await expect(page.locator('body')).not.toContainText('This page could not be found');
  await expect(page.locator('body')).not.toContainText('Internal Server Error');
});

test('launch home remains usable at a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', {
    level: 1,
    name: 'One connected HubSpot revenue intelligence product.'
  })).toBeVisible();
  await expect(page.locator('a[href="/dashboard"]').first()).toBeVisible();
  await expect(page.locator('a[href="/builder"]').first()).toBeVisible();
});
