import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyReadinessSnapshot,
  normalizeReadinessIncidentOptions
} from '../src/readiness-regression-monitor.js';

test('normalizes safe defaults', () => {
  assert.deepEqual(normalizeReadinessIncidentOptions({}), {
    action: 'evaluate',
    workspaceId: null,
    incidentId: null,
    actor: 'system',
    note: null,
    cooldownMinutes: 360,
    limit: 200
  });
});

test('rejects invalid action and unsafe limits', () => {
  assert.throws(() => normalizeReadinessIncidentOptions({ action: 'delete' }), /action must be/);
  assert.throws(() => normalizeReadinessIncidentOptions({ cooldownMinutes: 5 }), /cooldownMinutes/);
  assert.throws(() => normalizeReadinessIncidentOptions({ limit: 1001 }), /limit/);
});

test('requires valid incident and workspace UUID values', () => {
  assert.throws(() => normalizeReadinessIncidentOptions({ workspaceId: 'all' }), /valid UUID/);
  assert.throws(() => normalizeReadinessIncidentOptions({ action: 'acknowledge' }), /incidentId is required/);
  assert.throws(() => normalizeReadinessIncidentOptions({ action: 'resolve', incidentId: 'bad' }), /valid UUID/);
});

test('detects a true ready to blocked regression', () => {
  assert.deepEqual(classifyReadinessSnapshot({
    ready: false,
    transitioned: true,
    previous_ready: true,
    score: 62,
    blockers: 2,
    warnings: 1
  }), {
    ready: false,
    transitionedToBlocked: true,
    severity: 'critical',
    score: 62,
    blockers: 2,
    warnings: 1
  });
});

test('does not alert on initial blocked onboarding state', () => {
  const result = classifyReadinessSnapshot({
    ready: false,
    transitioned: false,
    previous_ready: null,
    score: 35,
    blockers: 4,
    warnings: 0
  });
  assert.equal(result.transitionedToBlocked, false);
  assert.equal(result.severity, 'critical');
});

test('classifies recovery snapshots as healthy', () => {
  const result = classifyReadinessSnapshot({
    ready: true,
    transitioned: true,
    previous_ready: false,
    score: 100,
    blockers: 0,
    warnings: 0
  });
  assert.equal(result.ready, true);
  assert.equal(result.transitionedToBlocked, false);
});
