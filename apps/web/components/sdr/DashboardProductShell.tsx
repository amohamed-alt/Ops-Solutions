'use client';

import { useLayoutEffect } from 'react';

import { DashboardWorkspaceExperience } from './DashboardWorkspaceExperience';
import './dashboard-product-polish.css';

type WorkspaceContext = {
  id: string;
  name: string;
  portalId: string;
};

type CapturedDrilldown = {
  workspaceId: string;
  objectType: string;
  results: Array<{ id: string }>;
};

const HUBSPOT_OBJECT_TYPE_IDS: Record<string, string> = {
  calls: '0-48',
  companies: '0-2',
  contacts: '0-1',
  deals: '0-3',
  meetings: '0-47',
  tasks: '0-27',
  tickets: '0-5'
};

const HUBSPOT_OBJECT_ALIASES: Record<string, string> = {
  call: 'calls',
  company: 'companies',
  contact: 'contacts',
  deal: 'deals',
  meeting: 'meetings',
  task: 'tasks',
  ticket: 'tickets'
};

const PANEL_ACTIONS: Record<string, string[]> = {
  'Activity performance': ['Calls', 'Meetings', 'Overdue tasks'],
  'Pipeline by stage': ['Open deals', 'Deals at risk'],
  'Call outcomes': ['Calls'],
  'Meeting outcomes': ['Meetings']
};

function normalizedObjectType(value: string) {
  const normalized = value.trim().toLowerCase();
  return HUBSPOT_OBJECT_ALIASES[normalized] ?? normalized;
}

function hubSpotRecordUrl(portalId: string, objectType: string, recordId: string) {
  const normalized = normalizedObjectType(objectType);
  const encodedPortalId = encodeURIComponent(portalId);
  const encodedRecordId = encodeURIComponent(recordId);
  const legacyBase = `https://app.hubspot.com/contacts/${encodedPortalId}`;

  if (normalized === 'contacts') return `${legacyBase}/contact/${encodedRecordId}`;
  if (normalized === 'companies') return `${legacyBase}/company/${encodedRecordId}`;
  if (normalized === 'deals') return `${legacyBase}/deal/${encodedRecordId}`;

  const objectTypeId = HUBSPOT_OBJECT_TYPE_IDS[normalized];
  return objectTypeId ? `${legacyBase}/record/${objectTypeId}/${encodedRecordId}` : null;
}

function findKpiButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('.ric-kpi h3'))
    .find((heading) => heading.textContent?.trim() === label)
    ?.closest<HTMLButtonElement>('button.ric-kpi') ?? null;
}

function triggerKpi(label: string) {
  const button = findKpiButton(label);
  if (!button) return false;
  button.click();
  return true;
}

function createActionButton(label: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ric-chart-drill-button';
  button.textContent = label;
  button.setAttribute('aria-label', `Open ${label} records`);
  button.title = `Open ${label} records`;
  button.addEventListener('click', () => triggerKpi(label));
  return button;
}

function installPanelActions() {
  for (const panel of document.querySelectorAll<HTMLElement>('.ric-panel')) {
    const title = panel.querySelector('h2')?.textContent?.trim();
    if (!title || panel.dataset.productPolished === 'true') continue;

    const actions = PANEL_ACTIONS[title]?.filter((label) => findKpiButton(label));
    if (!actions?.length) continue;

    panel.dataset.productPolished = 'true';
    const header = panel.querySelector<HTMLElement>(':scope > header');
    if (!header) continue;

    const actionGroup = document.createElement('div');
    actionGroup.className = 'ric-panel-drill-actions';
    actionGroup.setAttribute('aria-label', `${title} drill-down actions`);
    for (const label of actions) actionGroup.append(createActionButton(label));
    header.append(actionGroup);

    const chart = panel.querySelector<HTMLElement>('.ric-chart');
    const primaryAction = actions[0];
    if (chart && primaryAction) {
      chart.classList.add('ric-chart-interactive');
      chart.tabIndex = 0;
      chart.setAttribute('role', 'button');
      chart.setAttribute('aria-label', `Open ${primaryAction} records behind this chart`);
      chart.title = `Open ${primaryAction} records`;
      chart.addEventListener('click', () => triggerKpi(primaryAction));
      chart.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          triggerKpi(primaryAction);
        }
      });
    }
  }
}

function improveDashboardSemantics() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button.ric-kpi')) {
    if (!button.title) button.title = `Open ${button.querySelector('h3')?.textContent?.trim() || 'report'} records`;
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('.ric-attention button')) {
    if (!button.title) button.title = `Open ${button.querySelector('h3')?.textContent?.trim() || 'attention'} records`;
  }
}

function installHubSpotLinks(
  captured: CapturedDrilldown,
  workspaces: Map<string, WorkspaceContext>,
  attempt = 0
) {
  const portalId = workspaces.get(captured.workspaceId)?.portalId;
  const drawer = document.querySelector<HTMLElement>('.ric-drawer');
  const records = drawer?.querySelectorAll<HTMLElement>('.ric-drawer-table article');

  if (!portalId || !drawer || !records || records.length !== captured.results.length) {
    if (attempt < 24) window.setTimeout(() => installHubSpotLinks(captured, workspaces, attempt + 1), 50);
    return;
  }

  records.forEach((record, index) => {
    const row = captured.results[index];
    if (!row?.id) return;

    const href = hubSpotRecordUrl(portalId, captured.objectType, row.id);
    if (!href) return;

    const recordMain = record.querySelector<HTMLElement>('.ric-record-main');
    if (!recordMain) return;

    const existingLink = recordMain.querySelector<HTMLAnchorElement>('.ric-hubspot-record-link');
    if (record.dataset.hubspotRecordId === row.id && existingLink?.href === href) return;

    existingLink?.remove();
    record.dataset.hubspotRecordId = row.id;

    const link = document.createElement('a');
    link.className = 'ric-hubspot-record-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.title = 'Open this record in HubSpot';
    link.setAttribute('aria-label', 'Open this record in HubSpot');
    link.innerHTML = '<span>Open in HubSpot</span><b aria-hidden="true">↗</b>';
    recordMain.append(link);
  });

  drawer.dataset.hubspotLinksReady = 'true';
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function DashboardProductShell() {
  useLayoutEffect(() => {
    const rawFetch = window.fetch;
    const originalFetch = rawFetch.bind(window);
    const workspaces = new Map<string, WorkspaceContext>();
    let latestDrilldown: CapturedDrilldown | null = null;

    const enhancedFetch: typeof window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const url = new URL(requestUrl(args[0]), window.location.origin);

      if (url.origin === window.location.origin) {
        if (url.pathname === '/api/customer/workspaces') {
          void response.clone().json().then((payload) => {
            const rows = Array.isArray(payload?.results) ? payload.results : [];
            for (const row of rows) {
              const workspace = row?.workspace;
              if (!workspace?.id || workspace.portal_id === null || workspace.portal_id === undefined) continue;
              workspaces.set(String(workspace.id), {
                id: String(workspace.id),
                name: String(workspace.name || 'Workspace'),
                portalId: String(workspace.portal_id)
              });
            }
            if (latestDrilldown) installHubSpotLinks(latestDrilldown, workspaces);
          }).catch(() => undefined);
        }

        const match = url.pathname.match(/^\/api\/dashboard\/([^/]+)\/reports\/([^/]+)$/);
        if (match) {
          void response.clone().json().then((payload) => {
            const drilldown = payload?.drilldown;
            if (!drilldown || !Array.isArray(drilldown.results)) return;
            latestDrilldown = {
              workspaceId: decodeURIComponent(match[1]),
              objectType: String(drilldown.objectType || match[2]),
              results: drilldown.results.map((row: { id?: string | number }) => ({ id: String(row?.id ?? '') }))
            };
            installHubSpotLinks(latestDrilldown, workspaces);
          }).catch(() => undefined);
        }
      }

      return response;
    };

    window.fetch = enhancedFetch;

    const observer = new MutationObserver(() => {
      installPanelActions();
      improveDashboardSemantics();
      if (latestDrilldown) installHubSpotLinks(latestDrilldown, workspaces);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    installPanelActions();
    improveDashboardSemantics();

    return () => {
      observer.disconnect();
      if (window.fetch === enhancedFetch) window.fetch = rawFetch;
    };
  }, []);

  return <DashboardWorkspaceExperience />;
}
