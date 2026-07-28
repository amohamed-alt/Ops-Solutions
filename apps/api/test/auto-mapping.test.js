import assert from 'node:assert/strict';
import test from 'node:test';

import { AUTO_MAPPING_CONFIDENCE, selectAutoMappings } from '../src/auto-mapping.js';

test('selectAutoMappings chooses only the strongest safe suggestion per semantic slot', () => {
  const suggestions = [
    {
      semanticKey: 'lead_quality',
      objectType: 'contacts',
      propertyName: 'lead_rank_old',
      confidence: 0.87
    },
    {
      semanticKey: 'lead_quality',
      objectType: 'contacts',
      propertyName: 'lead_priority',
      confidence: 0.94
    },
    {
      semanticKey: 'lead_source',
      objectType: 'contacts',
      propertyName: 'source_guess',
      confidence: AUTO_MAPPING_CONFIDENCE - 0.01
    }
  ];

  assert.deepEqual(selectAutoMappings(suggestions), [
    {
      semanticKey: 'lead_quality',
      objectType: 'contacts',
      propertyName: 'lead_priority',
      confidence: 0.94,
      reasons: []
    }
  ]);
});

test('selectAutoMappings never replaces an existing manual or approved slot', () => {
  const suggestions = [{
    semantic_key: 'renewal_date',
    object_type: 'companies',
    property_name: 'renewal_date_inferred',
    confidence: 0.99,
    reasons: ['label match']
  }];
  const existing = [{ semantic_key: 'renewal_date', object_type: 'companies' }];

  assert.deepEqual(selectAutoMappings(suggestions, existing), []);
});

test('selectAutoMappings keeps object types tenant configuration slots independent', () => {
  const suggestions = [
    {
      semanticKey: 'country',
      objectType: 'contacts',
      propertyName: 'contact_country',
      confidence: 0.91
    },
    {
      semanticKey: 'country',
      objectType: 'companies',
      propertyName: 'company_country',
      confidence: 0.92
    }
  ];

  assert.equal(selectAutoMappings(suggestions).length, 2);
});
