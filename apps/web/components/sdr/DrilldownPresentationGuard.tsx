'use client';

import { useEffect } from 'react';

import {
  isDashboardDrilldownRequest,
  preferDrilldownDisplayProperties,
  truthfulDrilldownFreshnessText
} from './drilldown-presentation-contract.js';

function rewriteLegacyFreshnessText(root: ParentNode) {
  const candidates = root.querySelectorAll('.cc2-drawer p, .cc2-drawer small');
  for (const node of candidates) {
    const current = node.textContent || '';
    const next = truthfulDrilldownFreshnessText(current);
    if (next !== current) node.textContent = next;
  }
}

async function decorateDrilldownResponse(response: Response) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;
  const decorated = preferDrilldownDisplayProperties(payload);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(decorated), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function DrilldownPresentationGuard() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      if (!response.ok || !isDashboardDrilldownRequest(input, init)) return response;
      return decorateDrilldownResponse(response);
    };

    const observer = new MutationObserver(() => rewriteLegacyFreshnessText(document));
    observer.observe(document.body, { childList: true, subtree: true });
    rewriteLegacyFreshnessText(document);

    return () => {
      observer.disconnect();
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
