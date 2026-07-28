import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { cleanup, render } from '@testing-library/react';

import { formatReportingConfidenceStatus } from '../components/sdr/reporting-confidence-status.ts';
import { installDom } from './setup/dom.mjs';

function ReportingConfidenceFixture({ confidence }) {
  const status = formatReportingConfidenceStatus(confidence);
  if (!status) return null;

  return React.createElement(
    'section',
    { 'aria-label': 'Reporting confidence' },
    React.createElement('strong', null, status.label),
    React.createElement('p', null, status.detail),
    status.actionHref && status.actionLabel
      ? React.createElement('a', { href: status.actionHref }, status.actionLabel)
      : null
  );
}

function withDom(run) {
  const restoreDom = installDom();
  try {
    run();
  } finally {
    cleanup();
    restoreDom();
  }
}

test('rendered inferred reporting shows truthful confidence and remediation', () => {
  withDom(() => {
    const view = render(React.createElement(ReportingConfidenceFixture, {
      confidence: {
        level: 'inferred',
        inferredMappings: 2,
        minimumInferredConfidence: 0.87,
        message: null
      }
    }));

    assert.equal(view.getByText('Inferred reporting').textContent, 'Inferred reporting');
    assert.match(view.getByText(/minimum mapping confidence/i).textContent ?? '', /87%/);
    assert.equal(view.getByRole('link', { name: 'Confirm mappings' }).getAttribute('href'), '/settings/mappings');
    assert.equal(view.queryByText('inferred_auto'), null);
  });
});

test('rendered exact reporting does not show a remediation action', () => {
  withDom(() => {
    const view = render(React.createElement(ReportingConfidenceFixture, {
      confidence: {
        level: 'exact',
        exactMappings: 4,
        message: 'This report uses confirmed CRM mappings.'
      }
    }));

    assert.equal(view.getByText('Exact reporting').textContent, 'Exact reporting');
    assert.equal(view.getByText('This report uses confirmed CRM mappings.').textContent, 'This report uses confirmed CRM mappings.');
    assert.equal(view.queryByRole('link'), null);
  });
});

test('rendered proxy reporting clearly links to mapping recovery', () => {
  withDom(() => {
    const view = render(React.createElement(ReportingConfidenceFixture, {
      confidence: {
        level: 'proxy',
        message: 'Core analytics are shown because Renewal Date is not mapped.'
      }
    }));

    assert.equal(view.getByText('Proxy reporting').textContent, 'Proxy reporting');
    assert.match(view.getByText(/renewal date is not mapped/i).textContent ?? '', /Core analytics/);
    assert.equal(view.getByRole('link', { name: 'Review mappings' }).getAttribute('href'), '/settings/mappings');
  });
});
