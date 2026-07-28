import assert from 'node:assert/strict';
import test from 'node:test';

import {
  degradeRevenueReport,
  isReportConfigurationRequired,
  reportingDegradation
} from '../src/scoped-revenue-reporting.js';

test('recognizes only explicit report configuration errors', () => {
  assert.equal(isReportConfigurationRequired({ category: 'REPORT_CONFIGURATION_REQUIRED' }), true);
  assert.equal(isReportConfigurationRequired({ code: 'REPORT_CONFIGURATION_REQUIRED' }), true);
  assert.equal(isReportConfigurationRequired({ code: 'ECONNRESET' }), false);
  assert.equal(isReportConfigurationRequired(new Error('database unavailable')), false);
});

test('degrades a configured report request to a truthful core report', () => {
  const coreReport = {
    generatedAt: '2026-07-28T00:00:00.000Z',
    filters: { from: '2026-07-01', to: '2026-07-28' },
    executive: { contacts: 42 },
    drilldowns: ['contacts-total']
  };
  const error = Object.assign(
    new Error('Lead Quality mapping is required for the priority contact report.'),
    { category: 'REPORT_CONFIGURATION_REQUIRED' }
  );

  const result = degradeRevenueReport(coreReport, error, 'full');

  assert.deepEqual(result.executive, coreReport.executive);
  assert.deepEqual(result.drilldowns, coreReport.drilldowns);
  assert.equal(result.requestedScope, 'full');
  assert.equal(result.availableScope, 'core');
  assert.equal(result.reportingDegradation.active, true);
  assert.equal(result.reportingDegradation.level, 'proxy');
  assert.match(result.reportingDegradation.message, /Lead Quality mapping/);
  assert.match(result.reportingDegradation.nextAction, /semantic mappings/i);
});

test('reporting degradation does not claim exact or inferred data', () => {
  const result = reportingDegradation(
    { message: 'Renewal Date mapping on deals is required.' },
    'operating'
  );

  assert.equal(result.requestedScope, 'operating');
  assert.equal(result.availableScope, 'core');
  assert.equal(result.level, 'proxy');
  assert.equal(result.category, 'REPORT_CONFIGURATION_REQUIRED');
  assert.equal(Object.hasOwn(result, 'exact'), false);
  assert.equal(Object.hasOwn(result, 'inferred'), false);
});
