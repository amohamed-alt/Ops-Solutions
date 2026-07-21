import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMappingSuggestions, inferValueMapping } from '../src/semantic.js';

test('maps a custom lead tier property to lead quality', () => {
  const fields = [{
    semantic_key: 'lead_quality',
    object_types: ['contacts'],
    expected_types: ['enumeration'],
    keyword_hints: ['lead rank', 'lead tier', 'priority']
  }];
  const properties = [{
    object_type: 'contacts',
    property_name: 'prospect_tier',
    label: 'Lead Tier',
    description: 'Sales priority classification',
    group_name: 'contactinformation',
    field_type: 'select',
    data_type: 'enumeration',
    hubspot_defined: false,
    options: [
      { label: 'Tier 1', value: 'tier_1' },
      { label: 'Tier 2', value: 'tier_2' },
      { label: 'Tier 3', value: 'tier_3' }
    ]
  }];

  const suggestions = buildMappingSuggestions(fields, properties);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].propertyName, 'prospect_tier');
  assert.ok(suggestions[0].confidence >= 0.8);
});

test('infers canonical lead quality values', () => {
  const mapping = inferValueMapping('lead_quality', [
    { label: 'Rank A', value: 'A' },
    { label: 'Rank B', value: 'B' },
    { label: 'Rank C', value: 'C' }
  ]);

  assert.deepEqual(mapping, {
    A: 'highest',
    B: 'medium',
    C: 'lowest'
  });
});

test('limits suggestions to three properties per semantic field and object', () => {
  const fields = [{
    semantic_key: 'market',
    object_types: ['companies'],
    expected_types: ['string'],
    keyword_hints: ['market', 'region']
  }];
  const properties = Array.from({ length: 5 }, (_, index) => ({
    object_type: 'companies',
    property_name: `market_${index}`,
    label: `Market ${index}`,
    description: '',
    group_name: 'companyinformation',
    field_type: 'text',
    data_type: 'string',
    hubspot_defined: false,
    options: []
  }));

  const suggestions = buildMappingSuggestions(fields, properties);
  assert.equal(suggestions.length, 3);
});
