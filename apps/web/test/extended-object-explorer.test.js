import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPath = new URL('../components/sdr/ExtendedObjectExplorerClient.tsx', import.meta.url);
const catalogRoutePath = new URL('../app/api/dashboard/[workspaceId]/extended-objects/route.ts', import.meta.url);
const recordsRoutePath = new URL('../app/api/dashboard/[workspaceId]/extended-objects/[objectType]/records/[reportKey]/route.ts', import.meta.url);
const exportRoutePath = new URL('../app/api/dashboard/[workspaceId]/extended-objects/[objectType]/export/[reportKey]/route.ts', import.meta.url);

test('dynamic object explorer uses customer-authorized server search and bounded export', async () => {
  const component = await readFile(componentPath, 'utf8');
  assert.match(component, /\/extended-objects\/\$\{encodeURIComponent\(objectType\)\}\/records/);
  assert.match(component, /exportLimit:\s*25000/);
  assert.match(component, /Search all record properties/);
  assert.match(component, /Open in HubSpot/);
  assert.match(component, /dashboard\/all-objects/);
  assert.doesNotMatch(component, /ADMIN_API_KEY|x-admin-key|client[_-]?secret|access[_-]?token/i);
});

test('extended object proxy routes enforce workspace access and bounded timeouts', async () => {
  const [catalog, records, exportRoute] = await Promise.all([
    readFile(catalogRoutePath, 'utf8'),
    readFile(recordsRoutePath, 'utf8'),
    readFile(exportRoutePath, 'utf8')
  ]);

  for (const source of [catalog, records, exportRoute]) {
    assert.match(source, /requireCustomerWorkspace/);
    assert.match(source, /internalAdminHeaders/);
    assert.match(source, /cache:\s*'no-store'/);
    assert.match(source, /AbortSignal\.timeout/);
  }
  assert.match(exportRoute, /content-disposition/);
  assert.match(exportRoute, /x-export-truncated/);
});
