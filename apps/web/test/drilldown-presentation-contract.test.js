import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isDashboardDrilldownRequest,
  preferDrilldownDisplayProperties,
  truthfulDrilldownFreshnessText
} from '../components/sdr/drilldown-presentation-contract.js';

test('detects only dashboard drilldown GET requests', () => {
  assert.equal(isDashboardDrilldownRequest('/api/dashboard/workspace-a/reports/portfolio-contacts?limit=50'), true);
  assert.equal(isDashboardDrilldownRequest('/api/dashboard/workspace-a/reports/portfolio-contacts', { method: 'POST' }), false);
  assert.equal(isDashboardDrilldownRequest('/api/dashboard/workspace-a/reports'), false);
});

test('prefers tenant labels for display while preserving raw properties', () => {
  const payload = {
    drilldown: {
      results: [
        {
          id: 'shared-record-id',
          properties: {
            firstname: 'Amina',
            hs_lead_status: 'rank_a',
            hubspot_owner_id: '123'
          },
          displayProperties: {
            hs_lead_status: 'Rank A – Priority',
            hubspot_owner_id: 'Sara Al-Qahtani'
          }
        }
      ]
    }
  };

  const result = preferDrilldownDisplayProperties(payload);
  const row = result.drilldown.results[0];

  assert.equal(row.properties.firstname, 'Amina');
  assert.equal(row.properties.hs_lead_status, 'Rank A – Priority');
  assert.equal(row.properties.hubspot_owner_id, 'Sara Al-Qahtani');
  assert.equal(row.rawProperties.hs_lead_status, 'rank_a');
  assert.equal(row.rawProperties.hubspot_owner_id, '123');
  assert.equal(payload.drilldown.results[0].properties.hs_lead_status, 'rank_a');
});

test('leaves raw properties untouched when presentation labels are absent', () => {
  const payload = { drilldown: { results: [{ id: '1', properties: { dealstage: 'stage-123' } }] } };
  assert.deepEqual(preferDrilldownDisplayProperties(payload), payload);
});

test('replaces false live claims with truthful sync language', () => {
  assert.equal(
    truthfulDrilldownFreshnessText('Live HubSpot records behind the selected number.'),
    'Synced HubSpot records behind the selected number.'
  );
  assert.equal(truthfulDrilldownFreshnessText('Live CRM record'), 'Sync timestamp unavailable');
  assert.equal(truthfulDrilldownFreshnessText('Synced 7/28/2026'), 'Synced 7/28/2026');
});
