import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executionStatusLabel,
  scheduleHealth,
  scheduleUpdatePayload
} from '../components/sdr/schedule-monitor.mjs';

const baseSchedule = {
  id: 'schedule-1',
  savedViewId: '11111111-1111-4111-8111-111111111111',
  name: 'Weekly executive report',
  frequency: 'weekly',
  weekday: 1,
  monthday: null,
  deliveryHour: 8,
  deliveryMinute: 0,
  timezone: 'Asia/Riyadh',
  recipients: ['ops@example.com'],
  format: 'xlsx',
  deliveryMode: 'attachment',
  enabled: true,
  nextRunAt: '2026-07-28T05:00:00.000Z',
  lastSuccessAt: '2026-07-21T05:00:00.000Z',
  lastFailureAt: null,
  lastError: null
};

test('schedule health reports a later failure instead of claiming healthy delivery', () => {
  const result = scheduleHealth({
    ...baseSchedule,
    lastSuccessAt: '2026-07-20T05:00:00.000Z',
    lastFailureAt: '2026-07-21T05:00:00.000Z',
    lastError: 'Transactional email provider is disabled.'
  }, new Date('2026-07-21T06:00:00.000Z'));

  assert.equal(result.state, 'failed');
  assert.equal(result.label, 'Needs attention');
  assert.match(result.detail, /provider is disabled/i);
});

test('paused schedules are never shown as delayed or healthy', () => {
  const result = scheduleHealth({ ...baseSchedule, enabled: false }, new Date('2026-08-01T00:00:00.000Z'));
  assert.equal(result.state, 'paused');
  assert.equal(result.label, 'Paused');
});

test('an overdue next run is surfaced as delayed', () => {
  const result = scheduleHealth({
    ...baseSchedule,
    lastSuccessAt: null,
    nextRunAt: '2026-07-21T04:00:00.000Z'
  }, new Date('2026-07-21T05:30:00.000Z'));

  assert.equal(result.state, 'delayed');
});

test('pause and resume payload preserves the full backend schedule contract', () => {
  const payload = scheduleUpdatePayload(baseSchedule, false);
  assert.deepEqual(payload, {
    name: 'Weekly executive report',
    savedViewId: '11111111-1111-4111-8111-111111111111',
    frequency: 'weekly',
    timezone: 'Asia/Riyadh',
    recipients: ['ops@example.com'],
    format: 'xlsx',
    deliveryMode: 'attachment',
    deliveryHour: 8,
    deliveryMinute: 0,
    weekday: 1,
    monthday: undefined,
    enabled: false
  });
});

test('execution labels distinguish delivery readiness from successful delivery', () => {
  assert.equal(executionStatusLabel({ status: 'ready_for_delivery', delivery_status: 'provider_not_configured' }), 'Provider not configured');
  assert.equal(executionStatusLabel({ status: 'delivered', delivery_status: 'delivered' }), 'Delivered');
  assert.equal(executionStatusLabel({ status: 'failed', delivery_status: 'failed' }), 'Failed');
});
