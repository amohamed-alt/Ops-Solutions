'use client';

import { useEffect, useMemo, useState } from 'react';

type PipelineStage = {
  pipelineId: string;
  stageId: string;
  pipelineLabel: string;
  stageLabel: string;
  deals: number;
  amount: number;
};

type ReportContext = {
  workspaceId: string;
  portalId: string | number | null;
  search: string;
  stages: PipelineStage[];
};

type DrilldownRow = {
  id: string;
  properties?: Record<string, string | undefined>;
  displayProperties?: Record<string, string | undefined>;
  syncedAt?: string | null;
};

type Drilldown = {
  objectType: string;
  propertyLabels?: Record<string, string>;
  results: DrilldownRow[];
};

const REPORT_PATTERN = /\/api\/dashboard\/([^/?#]+)\/reports(?:\?|$)/;
const OBJECT_IDS: Record<string, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
  tasks: '0-27',
  meetings: '0-47',
  calls: '0-48'
};

function requestContext(input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'GET') return null;
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
  const match = REPORT_PATTERN.exec(url.pathname + url.search);
  if (!match || url.searchParams.get('scope') === 'operating') return null;
  return { workspaceId: decodeURIComponent(match[1]), search: url.search };
}

function hubspotRecordUrl(portalId: string | number | null, objectType: string, recordId: string) {
  if (!portalId) return null;
  const normalized = objectType.toLowerCase().replace(/s$/, '') + 's';
  const base = `https://app.hubspot.com/contacts/${encodeURIComponent(String(portalId))}`;
  if (normalized === 'contacts') return `${base}/contact/${encodeURIComponent(recordId)}`;
  if (normalized === 'companies') return `${base}/company/${encodeURIComponent(recordId)}`;
  if (normalized === 'deals') return `${base}/record/0-3/${encodeURIComponent(recordId)}`;
  const objectId = OBJECT_IDS[normalized];
  return objectId ? `${base}/record/${objectId}/${encodeURIComponent(recordId)}` : null;
}

function rowLabel(row: DrilldownRow) {
  const properties = row.displayProperties ?? row.properties ?? {};
  return {
    name: [properties.firstname, properties.lastname].filter(Boolean).join(' ')
      || properties.dealname
      || properties.name
      || properties.hs_task_subject
      || `Record ${row.id}`,
    detail: properties.email
      || properties.dealstage
      || properties.company
      || properties.jobtitle
      || `HubSpot ID ${row.id}`
  };
}

export function DashboardPipelineStageActions() {
  const [context, setContext] = useState<ReportContext | null>(null);
  const [selectedStage, setSelectedStage] = useState<PipelineStage | null>(null);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      const details = requestContext(input, init);
      if (active && response.ok && details) {
        void response.clone().json().then((payload) => {
          const stages = Array.isArray(payload?.report?.pipelineByStage) ? payload.report.pipelineByStage : [];
          setContext({
            workspaceId: details.workspaceId,
            portalId: payload?.workspace?.portal_id ?? null,
            search: details.search,
            stages
          });
        }).catch(() => undefined);
      }
      return response;
    };
    return () => {
      active = false;
      window.fetch = originalFetch;
    };
  }, []);

  const stages = useMemo(() => (context?.stages ?? []).filter((row) => row.stageId).slice(0, 14), [context]);
  if (!context || stages.length === 0) return null;

  async function openStage(stage: PipelineStage) {
    setSelectedStage(stage);
    setBusy(stage.stageId);
    setError('');
    setDrilldown(null);
    try {
      const params = new URLSearchParams(context.search);
      params.delete('scope');
      params.set('pipelineId', stage.pipelineId);
      params.set('stageId', stage.stageId);
      params.set('limit', '50');
      params.set('offset', '0');
      const response = await fetch(`/api/dashboard/${encodeURIComponent(context.workspaceId)}/reports/open-deals?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `Drilldown failed with HTTP ${response.status}.`);
      setDrilldown(payload.drilldown ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open pipeline stage deals.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <details
        className="dashboard-pipeline-stage-actions"
        style={{
          position: 'fixed',
          left: 18,
          bottom: 18,
          zIndex: 72,
          width: 'min(360px, calc(100vw - 36px))',
          border: '1px solid rgba(15, 23, 42, 0.12)',
          borderRadius: 16,
          background: 'rgba(255,255,255,.97)',
          boxShadow: '0 18px 48px rgba(15,23,42,.16)',
          padding: 12
        }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Open pipeline stage deals</summary>
        <p style={{ margin: '8px 0', fontSize: 12, color: '#475569' }}>Keyboard-accessible drilldowns using the same raw pipeline and stage IDs as the chart.</p>
        <div style={{ display: 'grid', gap: 6, maxHeight: 260, overflow: 'auto' }}>
          {stages.map((stage) => (
            <button
              key={`${stage.pipelineId}-${stage.stageId}`}
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void openStage(stage)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '9px 10px',
                borderRadius: 10,
                border: '1px solid rgba(15,23,42,.1)',
                background: '#fff',
                textAlign: 'left',
                cursor: 'pointer'
              }}
            >
              <span><strong>{stage.stageLabel}</strong><small style={{ display: 'block', color: '#64748b' }}>{stage.pipelineLabel}</small></span>
              <span>{busy === stage.stageId ? 'Opening…' : `${Number(stage.deals || 0).toLocaleString()} deals`}</span>
            </button>
          ))}
        </div>
      </details>

      {selectedStage ? (
        <section
          className="dashboard-accessible-drilldown"
          role="dialog"
          aria-modal="true"
          aria-labelledby="accessible-drilldown-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(15,23,42,.38)',
            display: 'flex',
            justifyContent: 'flex-end'
          }}
        >
          <div style={{ width: 'min(620px, 100vw)', height: '100%', background: '#fff', padding: 24, overflow: 'auto', boxShadow: '-20px 0 60px rgba(15,23,42,.22)' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
              <div>
                <p style={{ margin: 0, color: '#64748b', fontSize: 12 }}>Synced HubSpot records behind the selected stage.</p>
                <h2 id="accessible-drilldown-title" style={{ margin: '5px 0 0' }}>{selectedStage.pipelineLabel} · {selectedStage.stageLabel}</h2>
              </div>
              <button type="button" onClick={() => { setSelectedStage(null); setDrilldown(null); setError(''); }}>Close</button>
            </header>
            {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}
            {!error && !drilldown ? <p>Loading synced deals…</p> : null}
            {drilldown?.results?.length === 0 ? <p>No deals match this stage and reporting period.</p> : null}
            <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
              {(drilldown?.results ?? []).map((row) => {
                const label = rowLabel(row);
                const href = hubspotRecordUrl(context.portalId, drilldown?.objectType || 'deals', row.id);
                return (
                  <article key={row.id} style={{ border: '1px solid rgba(15,23,42,.1)', borderRadius: 12, padding: 14 }}>
                    <strong>{label.name}</strong>
                    <p style={{ margin: '5px 0', color: '#475569' }}>{label.detail}</p>
                    {href ? <a href={href} target="_blank" rel="noreferrer">Open in HubSpot</a> : null}
                  </article>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
