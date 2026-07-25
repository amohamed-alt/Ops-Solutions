import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const stylesUrl = new URL('../app/settings/readiness/readiness.module.css', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('readiness incident inbox exposes operational filters and server-side sorting', async () => {
  const page = await source(pageUrl);
  assert.match(page, /incidentStatus/);
  assert.match(page, /incidentSeverity/);
  assert.match(page, /minimumBlockers/);
  assert.match(page, /activity_desc/);
  assert.match(page, /blockers_desc/);
  assert.match(page, /score_asc/);
  assert.match(page, /occurrences_desc/);
  assert.match(page, /incidentQuery/);
  assert.doesNotMatch(page, /filteredIncidents/);
});

test('incident filters remain URL-persisted without exposing cursor state', async () => {
  const page = await source(pageUrl);
  assert.match(page, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /params\.delete\('incidentPage'\)/);
  assert.doesNotMatch(page, /params\.set\('cursor'|nextIncidentCursor.*replaceState/);
  assert.doesNotMatch(page, /localStorage.*incidentStatus|localStorage.*incidentSeverity/);
});

test('incident inbox consumes bounded opaque cursor pages', async () => {
  const page = await source(pageUrl);
  assert.match(page, /INCIDENT_PAGE_SIZE=10/);
  assert.match(page, /pageInfo:\{limit:number;offset:number;hasNextPage:boolean;nextCursor:string\|null\}/);
  assert.match(page, /setNextIncidentCursor\(page\.pageInfo\?\.nextCursor\|\|null\)/);
  assert.match(page, /loadIncidents\(workspaceId,\{append:true,cursor:nextIncidentCursor\}\)/);
  assert.match(page, /aria-label="Readiness incident pagination"/);
  assert.doesNotMatch(page, /readiness-incidents\?limit=200/);
  assert.doesNotMatch(page, /Math\.ceil\(filteredIncidents\.length/);
});

test('dead-letter navigation focuses only incidents present in the loaded tenant result set', async () => {
  const page = await source(pageUrl);
  const openIncident = page.slice(page.indexOf('const openIncident='), page.indexOf('const summary='));
  assert.match(openIncident, /incidentRefs\.current\[incidentId\]/);
  assert.match(openIncident, /currently loaded result set/);
  assert.match(openIncident, /prefers-reduced-motion/);
  assert.match(openIncident, /target\.focus/);
});

test('filter controls remain responsive and accessible', async () => {
  const [page, styles] = await Promise.all([source(pageUrl), source(stylesUrl)]);
  assert.match(page, /aria-label="Readiness incident filters"/);
  assert.match(page, /role="status"/);
  assert.match(styles, /\.incidentFilters/);
  assert.match(styles, /@media\(max-width:980px\)/);
  assert.match(styles, /@media\(max-width:520px\)/);
});
