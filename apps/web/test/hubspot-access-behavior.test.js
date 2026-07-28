import assert from 'node:assert/strict';
import test from 'node:test';

import {
  missingHubSpotScopes,
  summarizeHubSpotAccess
} from '../components/sdr/hubspot-access.js';

test('missingHubSpotScopes returns only required scopes not granted by HubSpot', () => {
  const capabilities = {
    scopes: ['crm.objects.contacts.read', 'crm.objects.tasks.write'],
    requiredScopes: {
      createTask: ['crm.objects.tasks.write'],
      updateLifecycleStage: ['crm.objects.contacts.write']
    }
  };

  assert.deepEqual(missingHubSpotScopes(capabilities), ['crm.objects.contacts.write']);
});

test('summarizeHubSpotAccess distinguishes connected, ready, and reconnect workspaces', () => {
  const rows = [
    {
      workspace: { id: 'workspace-a', hubspot_status: 'connected' },
      capabilities: {
        scopes: ['crm.objects.tasks.write', 'crm.objects.contacts.write'],
        requiredScopes: {
          createTask: ['crm.objects.tasks.write'],
          updateLifecycleStage: ['crm.objects.contacts.write']
        }
      }
    },
    {
      workspace: { id: 'workspace-b', hubspot_status: 'connected' },
      capabilities: {
        scopes: ['crm.objects.contacts.read'],
        requiredScopes: {
          createTask: ['crm.objects.tasks.write']
        }
      }
    },
    {
      workspace: { id: 'workspace-c', hubspot_status: 'disconnected' },
      capabilities: null
    }
  ];

  assert.deepEqual(summarizeHubSpotAccess(rows), {
    connected: 2,
    ready: 1,
    needsReconnect: 1
  });
});

test('missingHubSpotScopes fails safely when capability metadata is unavailable', () => {
  assert.deepEqual(missingHubSpotScopes(null), []);
  assert.deepEqual(missingHubSpotScopes({ scopes: [], requiredScopes: {} }), []);
});
