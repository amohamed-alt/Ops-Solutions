import { expect, test } from '@playwright/test';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const portalId = 12345678;

function comparison(current = 0, previous = 0) {
  return { current, previous, deltaPercent: previous ? (current - previous) / previous * 100 : null };
}

function reportPayload() {
  return {
    workspace: {
      id: workspaceId,
      name: 'Riyadh Revenue Workspace',
      portal_id: portalId,
      hubspot_status: 'connected'
    },
    report: {
      generatedAt: '2026-07-28T18:00:00.000Z',
      filters: {
        from: '2026-07-01',
        to: '2026-07-28',
        ownerId: '',
        country: '',
        leadSource: '',
        pipelineId: '',
        stageId: '',
        days: 28
      },
      comparisonPeriod: { from: '2026-06-03', to: '2026-06-30' },
      filterOptions: {
        owners: [],
        countries: [],
        pipelines: [{ id: 'default', label: 'Sales Pipeline' }],
        stages: [{ id: 'appointmentscheduled', pipelineId: 'default', label: 'Qualified Meeting' }],
        leadSources: []
      },
      overview: {
        portfolioContacts: 12,
        missingOwnerContacts: 0,
        newContacts: 4,
        calls: 3,
        meetings: 2,
        meetingRate: 66.7,
        completedTasks: 5,
        openTasks: 1,
        openDeals: 1,
        openPipeline: 25000,
        wonDeals: 0,
        wonRevenue: 0,
        overdueTasks: 0,
        tasksDueToday: 1,
        dealsAtRisk: 0
      },
      comparisons: {
        newContacts: comparison(4, 3),
        calls: comparison(3, 2),
        meetings: comparison(2, 1),
        completedTasks: comparison(5, 4),
        wonDeals: comparison(),
        wonRevenue: comparison()
      },
      activityTrend: [{ day: '2026-07-28', calls: 3, meetings: 2, tasks: 5 }],
      pipelineByStage: [{
        pipelineId: 'default',
        stageId: 'appointmentscheduled',
        pipelineLabel: 'Sales Pipeline',
        stageLabel: 'Qualified Meeting',
        deals: 1,
        amount: 25000
      }],
      leadSourcePerformance: [],
      countryDistribution: [],
      ownerPerformance: [],
      outcomes: { calls: [], meetings: [], tasks: [] },
      dataQuality: { totalContacts: 12, score: 92, fields: [] },
      attention: {
        overdueTasks: 0,
        tasksDueToday: 1,
        missingOwnerContacts: 0,
        noNextActivityDeals: 0,
        overdueCloseDeals: 0,
        dealsAtRisk: 0
      }
    }
  };
}

test('chart click opens a labelled drilldown with the correct HubSpot record link', async ({ page }) => {
  let drilldownRequestUrl = '';

  await page.route('**/api/customer/workspaces', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{
          workspace: {
            id: workspaceId,
            name: 'Riyadh Revenue Workspace',
            portal_id: portalId,
            hubspot_status: 'connected'
          }
        }]
      })
    });
  });

  await page.route(`**/api/customer/workspaces/${workspaceId}/saved-views`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [] }) });
  });

  await page.route(`**/api/customer/workspaces/${workspaceId}/preferences`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ currency: 'SAR', locale: 'en-SA', timezone: 'Asia/Riyadh' })
    });
  });

  await page.route(`**/api/dashboard/${workspaceId}/reports?*`, async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('scope') === 'operating') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Not required for this flow.' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reportPayload()) });
  });

  await page.route(`**/api/dashboard/${workspaceId}/reports/open-deals?*`, async (route) => {
    drilldownRequestUrl = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        drilldown: {
          key: 'open-deals',
          objectType: 'deals',
          columns: ['dealname', 'dealstage', 'amount'],
          propertyLabels: { dealname: 'Deal name', dealstage: 'Deal stage', amount: 'Amount' },
          limit: 50,
          offset: 0,
          hasMore: false,
          results: [{
            id: '9001',
            properties: {
              dealname: 'GCC Expansion',
              dealstage: 'appointmentscheduled',
              amount: '25000'
            },
            displayProperties: {
              dealname: 'GCC Expansion',
              dealstage: 'Qualified Meeting',
              amount: '25,000'
            },
            syncedAt: '2026-07-28T17:55:00.000Z'
          }]
        }
      })
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Know what matters, then act.' })).toBeVisible();
  await expect(page.getByText('Qualified Meeting')).toBeVisible();

  const stageBar = page.locator('.cc2-chart.interactive .recharts-bar-rectangle').first();
  await expect(stageBar).toBeVisible();
  await stageBar.click();

  const drawer = page.locator('.cc2-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Sales Pipeline · Qualified Meeting' })).toBeVisible();
  await expect(drawer.getByText('GCC Expansion')).toBeVisible();
  await expect(drawer.getByText('Qualified Meeting', { exact: true })).toBeVisible();
  await expect(drawer.getByText('appointmentscheduled', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText('Synced HubSpot records behind the selected number.')).toBeVisible();

  const hubspotLink = drawer.getByRole('link', { name: /Open in HubSpot/i });
  await expect(hubspotLink).toHaveAttribute('href', `https://app.hubspot.com/contacts/${portalId}/record/0-3/9001`);

  const request = new URL(drilldownRequestUrl);
  expect(request.searchParams.get('pipelineId')).toBe('default');
  expect(request.searchParams.get('stageId')).toBe('appointmentscheduled');
});
