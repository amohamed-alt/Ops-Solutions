import { expect, test } from '@playwright/test';

const workspaceId = '11111111-1111-4111-8111-111111111111';

test('creates a persisted report definition with raw builder values', async ({ page }) => {
  let savedViewRequest = null;

  await page.route('**/api/customer/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            workspace: {
              id: workspaceId,
              name: 'Riyadh Revenue Workspace',
              hubspot_status: 'connected'
            }
          }
        ]
      })
    });
  });

  await page.route(`**/api/customer/workspaces/${workspaceId}/saved-views`, async (route) => {
    if (route.request().method() === 'POST') {
      savedViewRequest = await route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'view-1',
          name: savedViewRequest.name,
          section: savedViewRequest.section,
          datePreset: savedViewRequest.datePreset,
          widgetConfiguration: savedViewRequest.widgetConfiguration
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.route(`**/api/customer/workspaces/${workspaceId}/report-schedules`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [] })
    });
  });

  await page.goto('/builder');

  await expect(page.getByRole('heading', { name: /Report Builder, Dashboard Builder/i })).toBeVisible();
  await expect(page.getByText('Selected: Riyadh Revenue Workspace')).toBeVisible();

  await page.getByLabel('Report name').fill('Priority contacts by lifecycle stage');
  await page.getByLabel('Object').selectOption('contacts');
  await page.getByLabel('Metric').selectOption('count');
  await page.getByLabel('Group by').selectOption('lifecycle_stage');
  await page.getByLabel('Chart').selectOption('bar');
  await page.getByLabel('Date preset').selectOption('this_month');

  await page.getByRole('button', { name: 'Create report' }).click();

  await expect(page.getByRole('status')).toContainText('Report builder view created');
  expect(savedViewRequest).toEqual({
    name: 'Priority contacts by lifecycle stage',
    datePreset: 'this_month',
    section: 'overview',
    filters: {},
    widgetConfiguration: {
      builderType: 'report',
      objectType: 'contacts',
      metric: 'count',
      groupBy: 'lifecycle_stage',
      chartType: 'bar',
      version: 1
    }
  });
});
