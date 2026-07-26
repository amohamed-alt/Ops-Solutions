import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPropertyPresentation,
  decoratePropertyBag,
  firstPropertyValueLabel,
  labelDistribution,
  propertyValueLabel
} from '../src/crm-presentation.js';

const presentation = buildPropertyPresentation([
  {
    object_type: 'contacts',
    property_name: 'lifecyclestage',
    label: 'Lifecycle Stage',
    options: [
      { value: 'marketingqualifiedlead', label: 'Marketing Qualified Lead' },
      { value: 'customer', label: 'Customer' }
    ]
  },
  {
    object_type: 'contacts',
    property_name: 'company',
    label: 'Company Name',
    options: []
  },
  {
    object_type: 'deals',
    property_name: 'dealstage',
    label: 'Deal Stage',
    options: [{ value: 'appointmentscheduled', label: 'Appointment Scheduled' }]
  }
]);

test('resolves HubSpot option values to their original property labels', () => {
  assert.equal(
    propertyValueLabel(presentation, 'contacts', 'lifecyclestage', 'marketingqualifiedlead'),
    'Marketing Qualified Lead'
  );
  assert.equal(
    firstPropertyValueLabel(
      presentation,
      'contacts',
      ['hs_lead_status', 'lifecyclestage'],
      'customer'
    ),
    'Customer'
  );
  assert.equal(
    propertyValueLabel(presentation, 'contacts', 'unknown_property', 'IN_PROGRESS'),
    'In Progress'
  );
  assert.equal(
    propertyValueLabel(presentation, 'contacts', 'company', 'ACME Growth LAB'),
    'ACME Growth LAB'
  );
});

test('labels distributions without replacing the raw drilldown key', () => {
  assert.deepEqual(
    labelDistribution(
      presentation,
      'contacts',
      'lifecyclestage',
      [{ key: 'marketingqualifiedlead', value: 12 }]
    ),
    {
      propertyName: 'lifecyclestage',
      propertyLabel: 'Lifecycle Stage',
      rows: [{
        key: 'marketingqualifiedlead',
        label: 'Marketing Qualified Lead',
        value: 12
      }]
    }
  );
});

test('decorates record properties with owner, pipeline, stage, and option labels', () => {
  assert.deepEqual(
    decoratePropertyBag(
      presentation,
      'deals',
      {
        hubspot_owner_id: '77',
        pipeline: 'sales',
        dealstage: 'appointmentscheduled'
      },
      {
        owners: { 77: 'Marita Chedid' },
        pipelines: { sales: 'New Business' },
        stages: { 'sales:appointmentscheduled': 'Discovery Scheduled' }
      }
    ),
    {
      hubspot_owner_id: 'Marita Chedid',
      pipeline: 'New Business',
      dealstage: 'Discovery Scheduled'
    }
  );
});
