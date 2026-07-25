import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);

async function source() {
  return readFile(pageUrl, 'utf8');
}

test('readiness inbox delegates filtering and sorting to the tenant API', async () => {
  const page = await source();
  assert.match(page, /new URLSearchParams\(\{limit:String\(INCIDENT_PAGE_SIZE\),status:statusFilter,severity:severityFilter,minimumBlockers:String\(minimumBlockers\),sort:incidentSort\}\)/);
  assert.match(page, /readiness-incidents\?\$\{incidentQuery\(cursor\)\}/);
  assert.doesNotMatch(page, /const filteredIncidents=/);
  assert.doesNotMatch(page, /\.slice\(\(incidentPage-1\)\*INCIDENT_PAGE_SIZE/);
  assert.doesNotMatch(page, /limit=200/);
});

test('readiness inbox consumes the opaque next cursor without exposing offsets', async () => {
  const page = await source();
  assert.match(page, /pageInfo:\{limit:number;offset:number;hasNextPage:boolean;nextCursor:string\|null\}/);
  assert.match(page, /setNextIncidentCursor\(page\.pageInfo\?\.nextCursor\|\|null\)/);
  assert.match(page, /loadIncidents\(workspaceId,\{append:true,cursor:nextIncidentCursor\}\)/);
  assert.match(page, /Load more incidents/);
  assert.doesNotMatch(page, /incidentPageCount/);
  assert.doesNotMatch(page, /ChevronLeft|ChevronRight/);
});

test('filter changes reset the result set and remain URL-persisted', async () => {
  const page = await source();
  assert.match(page, /useEffect\(\(\)=>\{if\(workspaceId&&filtersReady\)void loadIncidents\(workspaceId\)/);
  assert.match(page, /setOrDelete\('incidentStatus',statusFilter,'all'\)/);
  assert.match(page, /setOrDelete\('incidentSeverity',severityFilter,'all'\)/);
  assert.match(page, /setOrDelete\('incidentSort',incidentSort,'activity_desc'\)/);
  assert.match(page, /params\.delete\('incidentPage'\)/);
});

test('cursor inbox preserves tenant safety and bounded page size', async () => {
  const page = await source();
  assert.match(page, /const INCIDENT_PAGE_SIZE=10/);
  assert.match(page, /\/api\/customer\/workspaces\/\$\{id\}\/readiness-incidents/);
  assert.match(page, /incidentRequestRef\.current\?\.abort\(\)/);
  assert.doesNotMatch(page, /accessToken|refreshToken|sessionToken|ADMIN_API_KEY|DATABASE_URL/i);
});
