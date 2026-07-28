import assert from 'node:assert/strict';
import test from 'node:test';

import {
  annotateReportingConfidence,
  classifyReportingConfidence,
  loadReportingConfidence
} from '../src/reporting-confidence.js';

test('confirmed mappings produce exact reporting confidence', () => {
  const result = classifyReportingConfidence([
    {
      semantic_key: 'lead_quality',
      object_type: 'contacts',
      property_name: 'lead_tier',
      source: 'manual',
      confidence: null
    },
    {
      semantic_key: 'renewal_date',
      object_type: 'deals',
      property_name: 'renewal_date',
      source: 'approved',
      confidence: 0.99
    }
  ]);

  assert.equal(result.level, 'exact');
  assert.equal(result.exactMappings, 2);
  assert.equal(result.inferredMappings, 0);
  assert.equal(result.confirmationRequired, false);
  assert.equal(result.nextAction, null);
});

test('auto-activated mappings produce truthful inferred confidence', () => {
  const result = classifyReportingConfidence([
    {
      semantic_key: 'lead_quality',
      object_type: 'contacts',
      property_name: 'customer_priority',
      source: 'inferred_auto',
      confidence: '0.9300'
    },
    {
      semantic_key: 'renewal_date',
      object_type: 'deals',
      property_name: 'contract_expiry',
      source: 'inferred_auto',
      confidence: '0.8700'
    },
    {
      semantic_key: 'revenue',
      object_type: 'deals',
      property_name: 'amount',
      source: 'manual',
      confidence: null
    }
  ]);

  assert.equal(result.level, 'inferred');
  assert.equal(result.exactMappings, 1);
  assert.equal(result.inferredMappings, 2);
  assert.equal(result.minimumInferredConfidence, 0.87);
  assert.equal(result.confirmationRequired, true);
  assert.match(result.message, /high-confidence inferred CRM mappings/i);
  assert.match(result.nextAction, /confirm inferred semantic mappings/i);
  assert.equal(result.mappings[0].propertyName, 'customer_priority');
  assert.equal(result.mappings[0].inferred, true);
});

test('confidence values are bounded and invalid mapping rows are ignored', () => {
  const result = classifyReportingConfidence([
    {
      semanticKey: 'market',
      objectType: 'companies',
      propertyName: 'territory',
      source: 'inferred_auto',
      confidence: 3
    },
    {
      semanticKey: '',
      objectType: 'contacts',
      propertyName: 'ignored',
      source: 'inferred_auto',
      confidence: 0.9
    }
  ]);

  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].confidence, 1);
  assert.equal(result.minimumInferredConfidence, 1);
});

test('loadReportingConfidence keeps workspace scoping in the query', async () => {
  const calls = [];
  const postgres = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [{
          semantic_key: 'lead_quality',
          object_type: 'contacts',
          property_name: 'lead_tier',
          source: 'inferred_auto',
          confidence: 0.91
        }]
      };
    }
  };

  const result = await loadReportingConfidence(postgres, 'workspace-a');
  assert.equal(result.level, 'inferred');
  assert.deepEqual(calls[0].values, ['workspace-a']);
  assert.match(calls[0].sql, /WHERE pm\.workspace_id = \$1/);
  assert.match(calls[0].sql, /pms\.workspace_id = pm\.workspace_id/);
});

test('annotateReportingConfidence preserves the report payload', () => {
  const report = { generatedAt: '2026-07-28T00:00:00.000Z', metrics: { contacts: 12 } };
  const confidence = classifyReportingConfidence([]);
  const annotated = annotateReportingConfidence(report, confidence);

  assert.deepEqual(annotated.metrics, { contacts: 12 });
  assert.equal(annotated.reportingConfidence.level, 'exact');
});
