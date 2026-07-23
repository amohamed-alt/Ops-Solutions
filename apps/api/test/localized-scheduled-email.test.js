import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  buildScheduledReportMessage,
  resolveScheduledReportBranding
} from '../src/email-delivery.js';

const deliverySource = new URL('../src/email-delivery.js', import.meta.url);

function sampleRow(overrides = {}) {
  return {
    id: 'ba25e98c-d8de-4b9d-a48b-5a59cdb104fe',
    workspace_id: '5aa22a37-acde-4f5e-b8b5-36659b121116',
    workspace_name: 'Legacy Workspace',
    company_name: 'شركة أكمي الخليج',
    schedule_name: 'Weekly leadership review',
    view_name: 'Revenue pulse',
    filters: { from: '2026-07-01', to: '2026-07-23' },
    delivery_mode: 'attachment',
    export_completed_at: '2026-07-23T12:30:00.000Z',
    locale: 'ar-EG',
    timezone: 'Africa/Cairo',
    currency: 'EGP',
    accent_color: '#123abc',
    logo_url: 'https://cdn.example.com/acme-logo.png',
    ...overrides
  };
}

test('resolves safe tenant branding and localization with defensive fallbacks', () => {
  assert.deepEqual(resolveScheduledReportBranding(sampleRow()), {
    companyName: 'شركة أكمي الخليج',
    locale: 'ar-EG',
    timezone: 'Africa/Cairo',
    currency: 'EGP',
    accentColor: '#123abc',
    logoUrl: 'https://cdn.example.com/acme-logo.png'
  });

  assert.deepEqual(resolveScheduledReportBranding(sampleRow({
    company_name: '',
    locale: 'invalid_locale_@@',
    timezone: 'Mars/Olympus',
    currency: 'unsafe',
    accent_color: 'red',
    logo_url: 'http://user:password@example.com/logo.png'
  })), {
    companyName: 'Legacy Workspace',
    locale: 'en-US',
    timezone: 'UTC',
    currency: 'USD',
    accentColor: '#087f68',
    logoUrl: ''
  });
});

test('builds a localized branded message without leaking unsafe markup', () => {
  const message = buildScheduledReportMessage(sampleRow({
    company_name: '<script>alert(1)</script>',
    view_name: 'Board <Review>'
  }), 'https://ops.example.com/');

  assert.equal(message.context.locale, 'ar-EG');
  assert.equal(message.context.timezone, 'Africa/Cairo');
  assert.equal(message.context.currency, 'EGP');
  assert.match(message.subject, /Board <Review>/);
  assert.match(message.text, /Africa\/Cairo/);
  assert.match(message.text, /EGP · ar-EG/);
  assert.match(message.html, /border-left:4px solid #123abc/);
  assert.match(message.html, /https:\/\/cdn\.example\.com\/acme-logo\.png/);
  assert.match(message.html, /Board &lt;Review&gt;/);
  assert.doesNotMatch(message.html, /<script>/);
  assert.match(message.html, /settings\/reports\?workspaceId=5aa22a37-acde-4f5e-b8b5-36659b121116/);
});

test('email delivery claims workspace preferences with tenant-safe join and records context', async () => {
  const source = await readFile(deliverySource, 'utf8');
  assert.match(source, /LEFT JOIN workspace_preferences p ON p\.workspace_id = e\.workspace_id/);
  assert.match(source, /p\.company_name, p\.currency, p\.timezone, p\.locale, p\.accent_color, p\.logo_url/);
  assert.match(source, /WHERE id=\$1 AND workspace_id=\$4/);
  assert.match(source, /locale: context\.locale/);
  assert.match(source, /timezone: context\.timezone/);
  assert.match(source, /currency: context\.currency/);
  assert.doesNotMatch(source, /SELECT \*/);
});
