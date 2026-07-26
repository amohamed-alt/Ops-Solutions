import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const stylesUrl = new URL('../app/settings/readiness/readiness.module.css', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

function sectionBetween(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  const end = sourceText.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return sourceText.slice(start, end);
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
  const urlPersistenceEffect = sectionBetween(
    page,
    "useEffect(()=>{if(!filtersReady)return;const url=new URL(window.location.href)",
    "useEffect(()=>{const controller=new AbortController()",
  );

  assert.match(page, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(urlPersistenceEffect, /window\.history\.replaceState/);
  assert.match(urlPersistenceEffect, /params\.delete\('incidentPage'\)/);
  assert.doesNotMatch(urlPersistenceEffect, /cursor|nextIncidentCursor/);
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

test('dead-letter navigation focuses loaded incidents and fetches missing tenant incidents on demand', async () => {
  const page = await source(pageUrl);
  const focusIncident = sectionBetween(page, 'const focusIncident=', 'const openIncident=');
  const openIncident = sectionBetween(page, 'const openIncident=', 'useEffect(()=>{const params=');

  assert.match(focusIncident, /incidentRefs\.current\[incidentId\]/);
  assert.match(focusIncident, /prefers-reduced-motion/);
  assert.match(focusIncident, /target\.focus/);

  assert.match(openIncident, /if\(focusIncident\(incidentId\)\)\{/);
  assert.match(openIncident, /if\(persist\)setIncidentDeepLink\(incidentId\)/);
  assert.match(openIncident, /incidentDetailRequestRef\.current\?\.abort\(\)/);
  assert.match(openIncident, /readiness-incidents\/\$\{encodeURIComponent\(incidentId\)\}/);
  assert.match(openIncident, /current\.some\(item=>item\.id===incident\.id\)/);
  assert.match(openIncident, /requestAnimationFrame/);
  assert.match(openIncident, /focusIncident\(incident\.id\)/);
  assert.doesNotMatch(openIncident, /currently loaded result set/);
});

test('filter controls remain responsive and accessible', async () => {
  const [page, styles] = await Promise.all([source(pageUrl), source(stylesUrl)]);
  assert.match(page, /aria-label="Readiness incident filters"/);
  assert.match(page, /role="status"/);
  assert.match(styles, /\.incidentFilters/);
  assert.match(styles, /@media\(max-width:980px\)/);
  assert.match(styles, /@media\(max-width:520px\)/);
});
