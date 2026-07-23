import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduledReportMessage,
  resolveScheduledReportBranding
} from '../src/email-delivery.js';

const row = {
  id: 'ba25e98c-d8de-4b9d-a48b-5a59cdb104fe',
  workspace_id: '5aa22a37-acde-4f5e-b8b5-36659b121116',
  workspace_name: 'Legacy Workspace',
  company_name: 'Acme Gulf',
  schedule_name: 'Weekly leadership review',
  view_name: 'Revenue pulse',
  filters: { from: '2026-07-01', to: '2026-07-23' },
  delivery_mode: 'attachment',
  export_completed_at: '2026-07-23T12:30:00.000Z',
  locale: 'en-GB',
  timezone: 'Africa/Cairo',
  currency: 'EGP',
  accent_color: '#123abc',
  logo_url: 'https://cdn.example.com/acme-logo.png'
};

test('resolves tenant branding and localization preferences', () => {
  const context = resolveScheduledReportBranding(row);
  assert.equal(context.companyName, 'Acme Gulf');
  assert.equal(context.locale, 'en-GB');
  assert.equal(context.timezone, 'Africa/Cairo');
  assert.equal(context.currency, 'EGP');
  assert.equal(context.accentColor, '#123abc');
  assert.equal(context.logoUrl, 'https://cdn.example.com/acme-logo.png');
});

test('builds an escaped localized and branded scheduled report email', () => {
  const message = buildScheduledReportMessage({
    ...row,
    company_name: '<Acme Gulf>',
    view_name: 'Board <Review>'
  }, 'https://ops.example.com/');

  assert.match(message.subject, /Board <Review>/);
  assert.match(message.text, /Africa\/Cairo/);
  assert.match(message.text, /EGP · en-GB/);
  assert.match(message.html, /border-left:4px solid #123abc/);
  assert.match(message.html, /Board &lt;Review&gt;/);
  assert.match(message.html, /&lt;ACME GULF&gt;/);
  assert.doesNotMatch(message.html, /<Acme Gulf>/);
  assert.match(message.html, /settings\/reports\?workspaceId=5aa22a37-acde-4f5e-b8b5-36659b121116/);
});

test('falls back safely when optional presentation preferences are malformed', () => {
  const context = resolveScheduledReportBranding({
    workspace_name: 'Fallback Workspace',
    locale: 'invalid_locale_@@',
    timezone: 'Mars/Olympus',
    currency: '12',
    accent_color: 'red',
    logo_url: 'http://user:password@example.com/logo.png'
  });
  assert.equal(context.companyName, 'Fallback Workspace');
  assert.equal(context.locale, 'en-US');
  assert.equal(context.timezone, 'UTC');
  assert.equal(context.currency, 'USD');
  assert.equal(context.accentColor, '#087f68');
  assert.equal(context.logoUrl, '');
});
