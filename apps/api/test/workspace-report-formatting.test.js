import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatReportCurrency,
  formatReportDateTime,
  loadWorkspaceReportPreferences,
  serializeReportPreferences
} from '../src/workspace-report-formatting.js';
import { buildRevenueCsv } from '../src/report-exports.js';

const WORKSPACE_ID = '5839ad18-0d29-4e1b-aa51-47a0b9756aad';

function reportFixture() {
  return {
    generatedAt: '2026-07-23T12:00:00.000Z',
    filters: { from: '2026-07-01', to: '2026-07-23' },
    overview: { openPipeline: 12500, wonRevenue: 3000, calls: 8 },
    comparisons: {},
    activityTrend: [],
    pipelineByStage: [{ pipelineLabel: 'Sales', stageLabel: 'Qualified', deals: 2, amount: 12500 }],
    leadSourcePerformance: [],
    countryDistribution: [],
    ownerPerformance: [{ ownerName: 'A', email: 'a@example.com', calls: 1, meetings: 1, tasks: 1, meetingRate: 100, openDeals: 2, openPipeline: 12500, wonRevenue: 3000 }],
    outcomes: { calls: [], meetings: [], tasks: [] },
    attention: {},
    dataQuality: { fields: [], score: 90 }
  };
}

test('loads workspace-scoped reporting preferences with parameterized SQL', async () => {
  let captured;
  const preferences = await loadWorkspaceReportPreferences({
    async query(text, values) {
      captured = { text, values };
      return { rows: [{ currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' }] };
    }
  }, WORKSPACE_ID);
  assert.deepEqual(captured.values, [WORKSPACE_ID]);
  assert.match(captured.text, /workspace_id = \$1/);
  assert.deepEqual(preferences, { currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' });
});

test('falls back safely when persisted preferences are invalid or absent', () => {
  assert.deepEqual(serializeReportPreferences({ currency: 'unsafe', timezone: 'Mars/Base', locale: 'x' }), {
    currency: 'USD', timezone: 'UTC', locale: 'en-US'
  });
  assert.deepEqual(serializeReportPreferences(), { currency: 'USD', timezone: 'UTC', locale: 'en-US' });
});

test('formats currency and timestamps using the company locale and timezone', () => {
  const preferences = { currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' };
  assert.match(formatReportCurrency(12500, preferences), /AED/);
  assert.match(formatReportCurrency(12500, preferences), /12,500/);
  const timestamp = formatReportDateTime('2026-07-23T12:00:00.000Z', preferences);
  assert.ok(timestamp);
  assert.match(timestamp, /23/);
});

test('revenue CSV carries reporting context and localized financial values', () => {
  const csv = buildRevenueCsv({
    workspace: { id: WORKSPACE_ID, name: 'Dubai Co' },
    report: reportFixture(),
    dataFreshnessAt: '2026-07-23T11:30:00.000Z',
    preferences: { currency: 'AED', timezone: 'Asia/Dubai', locale: 'en-AE' }
  });
  assert.match(csv, /Currency,AED/);
  assert.match(csv, /Timezone,Asia\/Dubai/);
  assert.match(csv, /Locale,en-AE/);
  assert.match(csv, /Amount \(AED\)/);
  assert.match(csv, /AED/);
  assert.doesNotMatch(csv, /12500\.00/);
});
