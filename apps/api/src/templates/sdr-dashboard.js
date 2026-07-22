export const sdrDashboardTemplate = Object.freeze({
  key: 'sdr-foundation-v1',
  name: 'Smart SDR Dashboard',
  version: 2,
  description: 'A mapping-aware SDR dashboard for HubSpot contacts, deals, calls and meetings.',
  requiredSemanticFields: ['lead_quality'],
  optionalSemanticFields: ['country', 'market', 'lead_source'],
  virtualProperties: [
    {
      key: 'untouched_contact',
      label: 'Untouched Contact',
      objectType: 'contacts',
      rule: {
        operator: 'AND',
        conditions: [
          { field: 'notes_last_contacted', operator: 'missing' },
          { field: 'createdate', operator: 'before_days', value: 2 }
        ]
      }
    },
    {
      key: 'stale_contact',
      label: 'Stale Contact',
      objectType: 'contacts',
      rule: {
        operator: 'OR',
        conditions: [
          { field: 'notes_last_contacted', operator: 'before_days', value: 21 },
          {
            operator: 'AND',
            conditions: [
              { field: 'notes_last_contacted', operator: 'missing' },
              { field: 'createdate', operator: 'before_days', value: 21 }
            ]
          }
        ]
      }
    },
    {
      key: 'deal_at_risk',
      label: 'Deal at Risk',
      objectType: 'deals',
      rule: {
        operator: 'AND',
        conditions: [
          { field: 'hs_is_closed', operator: 'not_in', value: ['true', '1'] },
          {
            operator: 'OR',
            conditions: [
              { field: 'closedate', operator: 'before_days', value: 0 },
              { field: 'hs_next_activity_date', operator: 'missing' }
            ]
          }
        ]
      }
    }
  ],
  metrics: [
    {
      key: 'total_contacts',
      label: 'Portfolio Contacts',
      objectType: 'contacts',
      aggregation: 'count'
    },
    {
      key: 'high_priority_contacts',
      label: 'Highest Priority Leads',
      objectType: 'contacts',
      aggregation: 'count',
      filters: {
        operator: 'AND',
        conditions: [
          { semanticField: 'lead_quality', operator: 'semantic_equals', value: 'highest' }
        ]
      }
    },
    {
      key: 'untouched_contacts',
      label: 'Untouched Leads',
      objectType: 'contacts',
      aggregation: 'count',
      virtualProperty: 'untouched_contact'
    },
    {
      key: 'stale_contacts',
      label: 'Stale Leads',
      objectType: 'contacts',
      aggregation: 'count',
      virtualProperty: 'stale_contact'
    },
    {
      key: 'contacts_needing_action',
      label: 'Contacts Needing Action',
      objectType: 'contacts',
      aggregation: 'count',
      filters: {
        operator: 'OR',
        conditions: [
          { virtualProperty: 'untouched_contact', operator: 'equals', value: true },
          { virtualProperty: 'stale_contact', operator: 'equals', value: true }
        ]
      }
    },
    {
      key: 'open_pipeline',
      label: 'Open Pipeline',
      objectType: 'deals',
      aggregation: 'sum',
      field: 'amount',
      filters: {
        operator: 'AND',
        conditions: [
          { field: 'hs_is_closed', operator: 'not_in', value: ['true', '1'] }
        ]
      }
    },
    {
      key: 'deals_at_risk',
      label: 'Deals at Risk',
      objectType: 'deals',
      aggregation: 'count',
      virtualProperty: 'deal_at_risk'
    },
    {
      key: 'calls_last_30_days',
      label: 'Calls',
      objectType: 'calls',
      aggregation: 'count',
      activityWindowDays: 30
    },
    {
      key: 'meetings_last_30_days',
      label: 'Meetings',
      objectType: 'meetings',
      aggregation: 'count',
      activityWindowDays: 30
    }
  ],
  widgets: [
    { type: 'kpi', metric: 'total_contacts', size: 'small' },
    { type: 'kpi', metric: 'high_priority_contacts', size: 'small' },
    { type: 'kpi', metric: 'untouched_contacts', size: 'small' },
    { type: 'kpi', metric: 'deals_at_risk', size: 'small' },
    {
      type: 'leaderboard',
      title: 'Activity by Owner',
      objectType: 'calls',
      metric: 'count',
      groupBy: 'hubspot_owner_id'
    },
    {
      type: 'table',
      title: 'Priority Leads Needing Action',
      objectType: 'contacts',
      filters: {
        operator: 'AND',
        conditions: [
          { semanticField: 'lead_quality', operator: 'semantic_equals', value: 'highest' },
          {
            operator: 'OR',
            conditions: [
              { virtualProperty: 'untouched_contact', operator: 'equals', value: true },
              { virtualProperty: 'stale_contact', operator: 'equals', value: true }
            ]
          }
        ]
      },
      columns: ['firstname', 'lastname', 'email', 'phone', 'hubspot_owner_id', 'notes_last_contacted']
    }
  ]
});
