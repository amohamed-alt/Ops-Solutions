import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const stylesUrl = new URL('../app/settings/readiness/readiness.module.css', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('readiness incident inbox exposes operational filters and deterministic sorting', async () => {
  const page = await source(pageUrl);
  assert.match(page, /incidentStatus/);
  assert.match(page, /incidentSeverity/);
  assert.match(page, /minimumBlockers/);
  assert.match(page, /activity_desc/);
  assert.match(page, /blockers_desc/);
  assert.match(page, /score_asc/);
  assert.match(page, /occurrences_desc/);
  assert.match(page, /filteredIncidents/);
});

test('incident filters and page are persisted in the URL without navigation', async () => {
  const page = await source(pageUrl);
  assert.match(page, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /incidentPage/);
  assert.match(page, /params\.delete\(key\)/);
  assert.doesNotMatch(page, /localStorage.*incidentStatus|localStorage.*incidentSeverity/);
});

test('incident inbox paginates bounded data and resets invalid pages', async () => {
  const page = await source(pageUrl);
  assert.match(page, /INCIDENT_PAGE_SIZE=10/);
  assert.match(page, /readiness-incidents\?limit=200/);
  assert.match(page, /Math\.ceil\(filteredIncidents\.length\/INCIDENT_PAGE_SIZE\)/);
  assert.match(page, /if\(incidentPage>incidentPageCount\)setIncidentPage\(incidentPageCount\)/);
  assert.match(page, /aria-label="Readiness incident pages"/);
});

test('dead-letter navigation clears filters before focusing a correlated incident', async () => {
  const page = await source(pageUrl);
  const openIncident = page.slice(page.indexOf('const openIncident='), page.indexOf('const summary='));
  assert.match(openIncident, /setStatusFilter\('all'\)/);
  assert.match(openIncident, /setSeverityFilter\('all'\)/);
  assert.match(openIncident, /setMinimumBlockers\(0\)/);
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
