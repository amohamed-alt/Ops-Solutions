import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';

import { formatReportingConfidenceStatus } from '../components/sdr/reporting-confidence-status.ts';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost'
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.navigator = dom.window.navigator;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  return dom;
}

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

test('rendered reporting confidence uses labels and a remediation link for inferred mappings', () => {
  const dom = installDom();
  try {
    render(React.createElement(ReportingConfidenceFixture, {
      confidence: {
        level: 'inferred',
        inferredMappings: 2,
        minimumInferredConfidence: 0.87,
        message: null
      }
    }));

    assert.equal(screen.getByRole('strong').textContent, 'Inferred reporting');
    assert.match(screen.getByText(/minimum mapping confidence/i).textContent ?? '', /87%/);
    assert.equal(screen.getByRole('link', { name: 'Confirm mappings' }).getAttribute('href'), '/settings/mappings');
  } finally {
    cleanup();
    dom.window.close();
  }
});

test('rendered exact reporting does not show a remediation link', () => {
  const dom = installDom();
  try {
    render(React.createElement(ReportingConfidenceFixture, {
      confidence: {
        level: 'exact',
        exactMappings: 4,
        message: 'This report uses confirmed CRM mappings.'
      }
    }));

    assert.equal(screen.getByText('Exact reporting').textContent, 'Exact reporting');
    assert.equal(screen.queryByRole('link'), null);
  } finally {
    cleanup();
    dom.window.close();
  }
});
