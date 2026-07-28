import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAccessCustomerWorkspace,
  selectCustomerWorkspace
} from '../app/api/customer/workspace-access.js';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const COLLIDING_RECORD_ID = '9000001';

function customerContextForWorkspaceA() {
  return {
    user: { id: 'user-a' },
    workspaces: [
      {
        id: WORKSPACE_A,
        name: 'Tenant A',
        portalId: 1001,
        seededRecordIds: [COLLIDING_RECORD_ID]
      }
    ]
  };
}

test('allows a customer session to select its own workspace', () => {
  const context = customerContextForWorkspaceA();

  assert.equal(canAccessCustomerWorkspace(context, WORKSPACE_A), true);
  assert.equal(selectCustomerWorkspace(context, WORKSPACE_A)?.name, 'Tenant A');
});

test('denies workspace B even when both tenants contain the same CRM record ID', () => {
  const context = customerContextForWorkspaceA();
  const tenantBRecord = { workspaceId: WORKSPACE_B, recordId: COLLIDING_RECORD_ID };

  assert.equal(context.workspaces[0].seededRecordIds.includes(tenantBRecord.recordId), true);
  assert.equal(canAccessCustomerWorkspace(context, tenantBRecord.workspaceId), false);
  assert.equal(selectCustomerWorkspace(context, tenantBRecord.workspaceId), null);
});

test('does not grant access from malformed, missing, or partial workspace context', () => {
  for (const context of [null, {}, { workspaces: null }, { workspaces: [{ name: 'Missing ID' }] }]) {
    assert.equal(canAccessCustomerWorkspace(context, WORKSPACE_A), false);
  }
});

test('uses exact workspace IDs and rejects prefixes or case-insensitive lookalikes', () => {
  const context = customerContextForWorkspaceA();

  assert.equal(canAccessCustomerWorkspace(context, WORKSPACE_A.slice(0, -1)), false);
  assert.equal(canAccessCustomerWorkspace(context, `${WORKSPACE_A}-extra`), false);
  assert.equal(canAccessCustomerWorkspace(context, ` ${WORKSPACE_A} `), true);
});

test('falls back only to the first authorized workspace when no ID is requested', () => {
  const context = customerContextForWorkspaceA();

  assert.equal(selectCustomerWorkspace(context)?.id, WORKSPACE_A);
  assert.equal(selectCustomerWorkspace({ workspaces: [] }), null);
});
