import assert from 'node:assert/strict';
import test from 'node:test';

import { decorateRevenueDrilldownContract } from '../src/scoped-revenue-reporting.js';

function presentationDatabase() {
  return {
    async query(sql) {
      if (sql.includes('FROM crm_properties')) {
        return {
          rows: [
            {
              object_type: 'contacts',
              property_name: 'hs_lead_status',
              label: 'Lead Status',
              options: [
                { value: 'rank_a', label: 'Rank A – Priority' }
              ]
            },
            {
              object_type: 'contacts',
              property_name: 'hubspot_owner_id',
              label: 'Contact owner',
              options: []
            }
          ]
        };
      }
      if (sql.includes('FROM crm_owners')) {
        return {
          rows: [
            {
              owner_id: '42',
              user_id: null,
              first_name: 'Marita',
              last_name: 'Chedid',
              email: 'm.chedid@example.com'
            }
          ]
        };
      }
      if (sql.includes('FROM crm_pipelines')) return { rows: [] };
      if (sql.includes('FROM crm_pipeline_stages')) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

test('decorates operating drilldowns while preserving raw filter values', async () => {
  const result = await decorateRevenueDrilldownContract(
    presentationDatabase(),
    'workspace-id',
    {
      key: 'priority-needs-contact',
      objectType: 'contacts',
      columns: ['hs_lead_status', 'hubspot_owner_id'],
      limit: 50,
      offset: 0,
      hasMore: false,
      results: [
        {
          id: 'contact-1',
          properties: {
            hs_lead_status: 'rank_a',
            hubspot_owner_id: '42'
          }
        }
      ]
    }
  );

  assert.equal(result.propertyLabels.hs_lead_status, 'Lead Status');
  assert.equal(result.propertyLabels.hubspot_owner_id, 'Contact owner');
  assert.equal(result.results[0].properties.hs_lead_status, 'rank_a');
  assert.equal(result.results[0].properties.hubspot_owner_id, '42');
  assert.equal(result.results[0].displayProperties.hs_lead_status, 'Rank A – Priority');
  assert.equal(result.results[0].displayProperties.hubspot_owner_id, 'Marita Chedid');
});

test('preserves an existing decorated contract', async () => {
  const result = await decorateRevenueDrilldownContract(
    presentationDatabase(),
    'workspace-id',
    {
      key: 'calls',
      objectType: 'contacts',
      columns: ['hs_lead_status'],
      propertyLabels: { hs_lead_status: 'Custom visible label' },
      limit: 10,
      offset: 0,
      hasMore: false,
      results: [
        {
          id: 'contact-2',
          properties: { hs_lead_status: 'rank_a' },
          displayProperties: { hs_lead_status: 'Already decorated' }
        }
      ]
    }
  );

  assert.equal(result.propertyLabels.hs_lead_status, 'Custom visible label');
  assert.equal(result.results[0].displayProperties.hs_lead_status, 'Already decorated');
});

test('returns non-drilldown payloads unchanged', async () => {
  const payload = { status: 'not-a-drilldown' };
  const result = await decorateRevenueDrilldownContract(
    { query: () => assert.fail('database should not be queried') },
    'workspace-id',
    payload
  );

  assert.equal(result, payload);
});
