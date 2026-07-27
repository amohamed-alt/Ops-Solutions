import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMappingSuggestions, inferValueMapping } from '../src/semantic.js';

const semanticFields = [
  {
    semantic_key: 'lead_quality',
    object_types: ['contacts'],
    expected_types: ['enumeration'],
    keyword_hints: ['lead quality', 'priority']
  },
  {
    semantic_key: 'renewal_date',
    object_types: ['companies'],
    expected_types: ['date'],
    keyword_hints: ['renewal date']
  },
  {
    semantic_key: 'account_status',
    object_types: ['companies'],
    expected_types: ['enumeration'],
    keyword_hints: ['account status']
  }
];

test('Arabic property labels produce semantic mapping suggestions', () => {
  const suggestions = buildMappingSuggestions(semanticFields, [
    {
      object_type: 'contacts',
      property_name: 'custom_priority',
      label: 'أولوية العميل',
      description: 'تصنيف العميل المحتمل للمبيعات',
      group_name: 'معلومات العميل',
      data_type: 'enumeration',
      field_type: 'select',
      hubspot_defined: false,
      options: [
        { label: 'عالي', value: 'high_priority' },
        { label: 'متوسط', value: 'medium_priority' },
        { label: 'منخفض', value: 'low_priority' }
      ]
    },
    {
      object_type: 'companies',
      property_name: 'renewal_custom',
      label: 'تاريخ التجديد',
      description: 'موعد تجديد العقد القادم',
      group_name: 'العقود',
      data_type: 'date',
      field_type: 'date',
      hubspot_defined: false,
      options: []
    }
  ]);

  const leadQuality = suggestions.find((item) => item.semanticKey === 'lead_quality');
  const renewalDate = suggestions.find((item) => item.semanticKey === 'renewal_date');

  assert.equal(leadQuality?.propertyName, 'custom_priority');
  assert.ok(leadQuality.confidence >= 0.78);
  assert.equal(renewalDate?.propertyName, 'renewal_custom');
  assert.ok(renewalDate.confidence >= 0.78);
});

test('Arabic option labels infer unified lead quality values', () => {
  const mapping = inferValueMapping('lead_quality', [
    { label: 'عميل ساخن', value: 'arabic_hot' },
    { label: 'عميل دافئ', value: 'arabic_warm' },
    { label: 'عميل بارد', value: 'arabic_cold' }
  ]);

  assert.deepEqual(mapping, {
    arabic_hot: 'highest',
    arabic_warm: 'medium',
    arabic_cold: 'lowest'
  });
});

test('Arabic option labels infer unified account status values', () => {
  const mapping = inferValueMapping('account_status', [
    { label: 'نشط', value: 'active_ar' },
    { label: 'غير نشط', value: 'inactive_ar' },
    { label: 'عميل محتمل', value: 'prospect_ar' }
  ]);

  assert.deepEqual(mapping, {
    active_ar: 'active',
    inactive_ar: 'inactive',
    prospect_ar: 'prospect'
  });
});
