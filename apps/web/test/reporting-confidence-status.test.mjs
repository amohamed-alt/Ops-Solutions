import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatReportingConfidenceStatus,
  isDashboardReportRequest,
  reportingConfidenceFromPayload
} from '../components/sdr/reporting-confidence-status.ts';

test('exact reporting is presented as confirmed without a remediation link', () => {
  const confidence = reportingConfidenceFromPayload({
    report: {
      reportingConfidence: {
        level: 'exact',
        exactMappings: 4,
        inferredMappings: 0,
        message: 'This report uses confirmed CRM mappings.'
      }
    }
  });
  const status = formatReportingConfidenceStatus(confidence);

  assert.equal(status?.level, 'exact');
  assert.equal(status?.label, 'Exact reporting');
  assert.match(status?.detail ?? '', /confirmed CRM mappings/i);
  assert.equal(status?.actionHref, null);
});

test('inferred reporting shows minimum confidence and links to mapping confirmation', () => {
  const status = formatReportingConfidenceStatus({
    level: 'inferred',
    inferredMappings: 2,
    minimumInferredConfidence: 0.87,
    confirmationRequired: true,
    message: null
  });

  assert.equal(status?.label, 'Inferred reporting');
  assert.match(status?.detail ?? '', /87%/);
  assert.equal(status?.actionHref, '/settings/mappings');
  assert.equal(status?.actionLabel, 'Confirm mappings');
});

test('degraded core reports are presented truthfully as proxy reporting', () => {
  const confidence = reportingConfidenceFromPayload({
    report: {
      reportingDegradation: {
        active: true,
        level: 'proxy',
        message: 'Lead quality mapping is missing.',
        nextAction: 'Confirm semantic mappings.'
      }
    }
  });
  const status = formatReportingConfidenceStatus(confidence);

  assert.equal(status?.level, 'proxy');
  assert.equal(status?.label, 'Proxy reporting');
  assert.match(status?.detail ?? '', /mapping is missing/i);
  assert.equal(status?.actionHref, '/settings/mappings');
});

test('observer only inspects top-level GET report responses', () => {
  assert.equal(isDashboardReportRequest('/api/dashboard/workspace-a/reports?from=2026-07-01'), true);
  assert.equal(isDashboardReportRequest('/api/dashboard/workspace-a/reports?scope=operating'), true);
  assert.equal(isDashboardReportRequest('/api/dashboard/workspace-a/reports/open-deals'), false);
  assert.equal(isDashboardReportRequest('/api/dashboard/workspace-a/reports', { method: 'POST' }), false);
  assert.equal(isDashboardReportRequest('/api/customer/workspaces'), false);
});
