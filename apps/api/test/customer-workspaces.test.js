import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkspaceSlug,
  normalizeCompanyName,
  workspaceLimit
} from '../src/customer-workspaces.js';

test('normalizes company names and produces bounded unique slugs', () => {
  assert.equal(normalizeCompanyName('  ACME   Gulf  '), 'ACME Gulf');
  assert.equal(normalizeCompanyName('a'), 'a');
  assert.equal(buildWorkspaceSlug('ACME Gulf', 'deadbeef'), 'acme-gulf-deadbeef');
  assert.ok(buildWorkspaceSlug('x'.repeat(120), 'deadbeef').length <= 80);
});

test('applies a safe bounded workspace limit', () => {
  assert.equal(workspaceLimit(), 10);
  assert.equal(workspaceLimit(25), 25);
  assert.equal(workspaceLimit(0), 10);
  assert.equal(workspaceLimit(101), 10);
  assert.equal(workspaceLimit('not-a-number'), 10);
});
