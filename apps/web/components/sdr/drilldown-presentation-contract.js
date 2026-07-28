const DASHBOARD_DRILLDOWN_PATTERN = /\/api\/dashboard\/[^/]+\/reports\/[^/?#]+(?:[?#].*)?$/;

export function isDashboardDrilldownRequest(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return false;
  const url = input instanceof Request ? input.url : String(input);
  return DASHBOARD_DRILLDOWN_PATTERN.test(url);
}

function objectBag(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function preferDrilldownDisplayProperties(payload) {
  const drilldown = payload?.drilldown;
  if (!drilldown || !Array.isArray(drilldown.results)) return payload;

  return {
    ...payload,
    drilldown: {
      ...drilldown,
      results: drilldown.results.map((row) => {
        const rawProperties = objectBag(row?.properties);
        const displayProperties = objectBag(row?.displayProperties);
        if (Object.keys(displayProperties).length === 0) return row;
        return {
          ...row,
          rawProperties,
          properties: {
            ...rawProperties,
            ...displayProperties
          }
        };
      })
    }
  };
}

export function truthfulDrilldownFreshnessText(value) {
  if (value === 'Live HubSpot records behind the selected number.') {
    return 'Synced HubSpot records behind the selected number.';
  }
  if (value === 'Live CRM record') {
    return 'Sync timestamp unavailable';
  }
  return value;
}
