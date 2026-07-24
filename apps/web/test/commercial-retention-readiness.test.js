import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const billingPage = new URL('../app/settings/billing/page.tsx', import.meta.url);
const billingProxy = new URL('../app/api/customer/workspaces/[workspaceId]/billing/route.ts', import.meta.url);
const billingActionProxy = new URL('../app/api/customer/workspaces/[workspaceId]/billing/[action]/route.ts', import.meta.url);
const retentionPage = new URL('../app/dashboard/retention-budget/page.tsx', import.meta.url);
const retentionProxy = new URL('../app/api/customer/workspaces/[workspaceId]/retention-budget/[...path]/route.ts', import.meta.url);
const pdfAction = new URL('../components/sdr/PdfSnapshotAction.tsx', import.meta.url);
const dashboardPage = new URL('../app/dashboard/page.js', import.meta.url);

test('billing UI shows plans live quotas and provider-neutral lifecycle controls', async () => {
  const [page, proxy, actions] = await Promise.all([
    readFile(billingPage, 'utf8'),
    readFile(billingProxy, 'utf8'),
    readFile(billingActionProxy, 'utf8')
  ]);
  assert.match(page, /Plans & Usage/);
  assert.match(page, /liveCheckoutAvailable/);
  assert.match(page, /Start 14-day trial/);
  assert.match(page, /Schedule cancellation/);
  assert.match(page, /Apply manual plan/);
  assert.match(proxy, /requireCustomerWorkspace/);
  assert.match(actions, /ADMIN_ROLES/);
  assert.match(actions, /start-trial/);
  assert.match(actions, /subscription/);
  assert.doesNotMatch(`${page}\n${proxy}\n${actions}`, /STRIPE_SECRET|PAYMOB_SECRET|ADMIN_API_KEY|x-admin-key/i);
});

test('retention workspace provides explicit mapping validation matching and paginated reports', async () => {
  const [page, proxy] = await Promise.all([
    readFile(retentionPage, 'utf8'),
    readFile(retentionProxy, 'utf8')
  ]);
  assert.match(page, /Import & activate/);
  assert.match(page, /MAPPING_FIELDS/);
  assert.match(page, /companyName/);
  assert.match(page, /budgetMonth/);
  assert.match(page, /renewed_late/);
  assert.match(page, /Open in HubSpot|Company <ExternalLink/);
  assert.match(page, /Import history/);
  assert.match(proxy, /requireCustomerWorkspace/);
  assert.match(proxy, /ADMIN_ROLES/);
  assert.match(proxy, /customerHeaders\(request, hasBody/);
  assert.match(proxy, /body: hasBody \? await request\.text\(\) : undefined/);
});

test('dashboard mounts a PDF snapshot action using the current report filters', async () => {
  const [action, page] = await Promise.all([
    readFile(pdfAction, 'utf8'),
    readFile(dashboardPage, 'utf8')
  ]);
  assert.match(page, /PdfSnapshotAction/);
  assert.match(action, /\/reports\$/);
  assert.match(action, /query\.delete\('scope'\)/);
  assert.match(action, /query\.set\('format', 'pdf'\)/);
  assert.match(action, /content-disposition/);
  assert.match(action, /URL\.createObjectURL/);
});
