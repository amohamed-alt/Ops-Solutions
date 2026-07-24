'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Search,
  Shapes
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import './extended-object-explorer.css';

type WorkspaceRow = {
  workspace: {
    id: string;
    name: string;
    portal_id?: string | number | null;
    hubspot_status?: string;
  };
};

type CatalogObject = {
  objectType: string;
  label: string;
  category: string;
  standard: boolean;
  custom: boolean;
  synchronized: boolean;
  total: number;
  propertyCount: number;
  newestSync: string | null;
};

type Metric = {
  key: string;
  label: string;
  description: string;
  value: number;
  tone: string;
};

type DetailReport = {
  generatedAt: string;
  objectType: string;
  label: string;
  category: string;
  custom: boolean;
  total: number;
  columns: string[];
  metrics: Metric[];
  trend: Array<{ day: string; value: number }>;
  breakdowns: Array<{ key: string; label: string; rows: Array<{ key: string; value: number }> }>;
};

type RecordRow = {
  id: string;
  properties: Record<string, string | undefined>;
  hubspotCreatedAt?: string | null;
  hubspotUpdatedAt?: string | null;
  syncedAt?: string | null;
};

type RecordsPayload = {
  key: string;
  objectType: string;
  columns: string[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  search: string;
  sort: string;
  order: string;
  results: RecordRow[];
};

const STANDARD_OBJECT_IDS: Record<string, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
  products: '0-7',
  line_items: '0-8',
  quotes: '0-14',
  tasks: '0-27',
  meetings: '0-47',
  calls: '0-48',
  emails: '0-49'
};

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: dateInput(from), to: dateInput(to) };
}

function integer(value: unknown) {
  return new Intl.NumberFormat('en').format(Number(value ?? 0));
}

function titleCase(value: unknown) {
  return String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'The requested CRM report is unavailable.');
  return payload as T;
}

function recordUrl(portalId: string, objectType: string, recordId: string) {
  const base = `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}`;
  if (objectType === 'contacts') return `${base}/contact/${encodeURIComponent(recordId)}`;
  if (objectType === 'companies') return `${base}/company/${encodeURIComponent(recordId)}`;
  if (objectType === 'deals') return `${base}/deal/${encodeURIComponent(recordId)}`;
  const objectTypeId = STANDARD_OBJECT_IDS[objectType] || (/^\d+-\d+$/.test(objectType) ? objectType : '');
  return objectTypeId ? `${base}/record/${objectTypeId}/${encodeURIComponent(recordId)}` : base;
}

function queryString(values: Record<string, string | number>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  return params.toString();
}

function recordTitle(row: RecordRow, columns: string[]) {
  const p = row.properties || {};
  const candidates = [
    p.name,
    p.dealname,
    p.subject,
    p.hs_title,
    p.hs_lead_name,
    p.hs_email_subject,
    p.hs_task_subject,
    p.hs_meeting_title,
    p.hs_call_title,
    [p.firstname, p.lastname].filter(Boolean).join(' '),
    ...columns.map((column) => p[column])
  ];
  return candidates.find((value) => String(value || '').trim()) || `Record ${row.id}`;
}

export function ExtendedObjectExplorerClient({ objectType }: { objectType?: string }) {
  const router = useRouter();
  const [workspaceRows, setWorkspaceRows] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [catalog, setCatalog] = useState<CatalogObject[]>([]);
  const [detail, setDetail] = useState<DetailReport | null>(null);
  const [records, setRecords] = useState<RecordsPayload | null>(null);
  const [range, setRange] = useState(initialRange);
  const [draftRange, setDraftRange] = useState(initialRange);
  const [reportKey, setReportKey] = useState('total');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState('');
  const catalogAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const recordsAbort = useRef<AbortController | null>(null);

  const selectedWorkspace = useMemo(
    () => workspaceRows.find((row) => row.workspace.id === workspaceId)?.workspace ?? null,
    [workspaceId, workspaceRows]
  );

  const loadCatalog = useCallback(async (nextWorkspaceId: string) => {
    catalogAbort.current?.abort();
    const controller = new AbortController();
    catalogAbort.current = controller;
    const payload = await fetchJson<{ report: { objects: CatalogObject[] } }>(
      `/api/dashboard/${encodeURIComponent(nextWorkspaceId)}/extended-objects`,
      controller.signal
    );
    setCatalog(payload.report.objects ?? []);
  }, []);

  const loadDetail = useCallback(async (nextWorkspaceId: string, nextRange = range) => {
    if (!objectType) return;
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    const payload = await fetchJson<{ report: DetailReport }>(
      `/api/dashboard/${encodeURIComponent(nextWorkspaceId)}/extended-objects/${encodeURIComponent(objectType)}?${queryString(nextRange)}`,
      controller.signal
    );
    setDetail(payload.report);
  }, [objectType, range]);

  const loadRecords = useCallback(async (
    nextWorkspaceId: string,
    nextKey = reportKey,
    nextOffset = 0,
    nextSearch = search,
    nextRange = range
  ) => {
    if (!objectType) return;
    recordsAbort.current?.abort();
    const controller = new AbortController();
    recordsAbort.current = controller;
    setRecordsLoading(true);
    try {
      const payload = await fetchJson<{ records: RecordsPayload }>(
        `/api/dashboard/${encodeURIComponent(nextWorkspaceId)}/extended-objects/${encodeURIComponent(objectType)}/records/${encodeURIComponent(nextKey)}?${queryString({
          ...nextRange,
          search: nextSearch,
          offset: nextOffset,
          limit: 50,
          sort: 'updated',
          order: 'desc'
        })}`,
        controller.signal
      );
      setRecords(payload.records);
    } finally {
      if (recordsAbort.current === controller) setRecordsLoading(false);
    }
  }, [objectType, range, reportKey, search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchJson<{ results: WorkspaceRow[] }>('/api/customer/workspaces')
      .then(async (payload) => {
        if (!active) return;
        const rows = (payload.results ?? []).filter((row) => row.workspace.hubspot_status === 'connected');
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((row) => row.workspace.id === remembered) ?? rows[0] ?? null;
        setWorkspaceRows(rows);
        setWorkspaceId(selected?.workspace.id ?? '');
        if (!selected) throw new Error('Connect a HubSpot workspace before opening CRM object reports.');
        await loadCatalog(selected.workspace.id);
        if (objectType) {
          await Promise.all([
            loadDetail(selected.workspace.id),
            loadRecords(selected.workspace.id, 'total', 0, '')
          ]);
        }
      })
      .catch((loadError) => {
        if (!active || loadError?.name === 'AbortError') return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to open CRM object intelligence.');
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      catalogAbort.current?.abort();
      detailAbort.current?.abort();
      recordsAbort.current?.abort();
    };
  }, [loadCatalog, loadDetail, loadRecords, objectType]);

  async function changeWorkspace(nextWorkspaceId: string) {
    setWorkspaceId(nextWorkspaceId);
    window.localStorage.setItem('ops:last-dashboard-workspace', nextWorkspaceId);
    setError('');
    setLoading(true);
    try {
      await loadCatalog(nextWorkspaceId);
      if (objectType) {
        await Promise.all([
          loadDetail(nextWorkspaceId),
          loadRecords(nextWorkspaceId, reportKey, 0, search)
        ]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to change CRM workspace.');
    } finally {
      setLoading(false);
    }
  }

  async function applyRange() {
    if (!workspaceId || draftRange.from > draftRange.to) return;
    setRange(draftRange);
    setError('');
    setLoading(true);
    try {
      if (objectType) {
        await Promise.all([
          loadDetail(workspaceId, draftRange),
          loadRecords(workspaceId, reportKey, 0, search, draftRange)
        ]);
      } else {
        await loadCatalog(workspaceId);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to apply dashboard filters.');
    } finally {
      setLoading(false);
    }
  }

  async function openMetric(metric: Metric) {
    if (!workspaceId) return;
    setReportKey(metric.key);
    setSearch('');
    setSearchDraft('');
    await loadRecords(workspaceId, metric.key, 0, '');
    document.getElementById('extended-records')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function applySearch() {
    if (!workspaceId) return;
    setSearch(searchDraft);
    await loadRecords(workspaceId, reportKey, 0, searchDraft);
  }

  const exportHref = objectType && workspaceId
    ? `/api/dashboard/${encodeURIComponent(workspaceId)}/extended-objects/${encodeURIComponent(objectType)}/export/${encodeURIComponent(reportKey)}?${queryString({
        ...range,
        search,
        exportLimit: 25000,
        sort: 'updated',
        order: 'desc'
      })}`
    : '#';

  if (loading && !catalog.length && !detail) {
    return <main className="exo-shell"><div className="exo-state"><LoaderCircle className="exo-spin" />Loading CRM object intelligence…</div></main>;
  }

  return (
    <main className="exo-shell">
      <header className="exo-topbar">
        <Link href="/dashboard"><ArrowLeft size={16} />Revenue command center</Link>
        <div className="exo-brand"><Shapes size={20} /><span><small>OPS INTELLIGENCE</small><strong>All CRM Objects</strong></span></div>
        <div className="exo-controls">
          <select value={workspaceId} onChange={(event) => void changeWorkspace(event.target.value)} aria-label="Workspace">
            {workspaceRows.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}
          </select>
          <input type="date" value={draftRange.from} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))} />
          <input type="date" value={draftRange.to} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))} />
          <button type="button" onClick={() => void applyRange()}><RefreshCw size={15} />Apply</button>
        </div>
      </header>

      {error ? <div className="exo-error">{error}</div> : null}

      {!objectType ? (
        <>
          <section className="exo-hero">
            <span>DYNAMIC OBJECT CATALOG</span>
            <h1>Every synchronized HubSpot object, one reporting workspace.</h1>
            <p>Standard CRM, commerce, engagements and discovered custom objects appear automatically without hard-coded customer schemas.</p>
            <div><b>{integer(catalog.length)}</b><small>available objects</small><b>{integer(catalog.filter((row) => row.synchronized).length)}</b><small>with synchronized records</small></div>
          </section>
          <section className="exo-catalog">
            {catalog.map((row) => (
              <Link key={row.objectType} href={`/dashboard/all-objects/${encodeURIComponent(row.objectType)}`} className={!row.synchronized ? 'not-synced' : ''}>
                <span className="exo-catalog-icon"><Database size={18} /></span>
                <div><small>{row.category.toUpperCase()}{row.custom ? ' · CUSTOM' : ''}</small><h2>{row.label}</h2><p>{row.objectType}</p></div>
                <strong>{integer(row.total)}</strong>
                <footer><span>{integer(row.propertyCount)} properties</span><span>{row.synchronized ? 'Live data' : 'Discovered only'}</span></footer>
              </Link>
            ))}
            {catalog.length === 0 ? <div className="exo-state">No synchronized or discovered CRM objects are available yet.</div> : null}
          </section>
        </>
      ) : detail ? (
        <>
          <section className="exo-hero compact">
            <span>{detail.category.toUpperCase()}{detail.custom ? ' · CUSTOM OBJECT' : ''}</span>
            <h1>{detail.label} dashboard</h1>
            <p>Server-filtered records, scalable CSV export, live creation trend and generic data-quality diagnostics.</p>
            <div><b>{integer(detail.total)}</b><small>active records</small><b>{integer(detail.columns.length)}</b><small>reporting fields</small></div>
            <Link href="/dashboard/all-objects">Browse all objects</Link>
          </section>

          <section className="exo-metrics">
            {detail.metrics.map((metric) => (
              <button key={metric.key} type="button" className={`tone-${metric.tone}${reportKey === metric.key ? ' active' : ''}`} onClick={() => void openMetric(metric)}>
                <span />
                <strong>{integer(metric.value)}</strong>
                <h2>{metric.label}</h2>
                <p>{metric.description}</p>
                <small>Open records →</small>
              </button>
            ))}
          </section>

          <section className="exo-analytics">
            <article>
              <header><BarChart3 size={17} /><div><h2>Creation trend</h2><p>Records created in the selected period.</p></div></header>
              <div className="exo-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={detail.trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="exoArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f766e" stopOpacity={0.35} /><stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} minTickGap={30} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" stroke="#0f766e" fill="url(#exoArea)" strokeWidth={2.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>
            {detail.breakdowns.map((breakdown) => (
              <article key={breakdown.key}>
                <header><Database size={17} /><div><h2>{breakdown.label}</h2><p>Top values across active records.</p></div></header>
                <div className="exo-breakdown">
                  {breakdown.rows.map((row) => <div key={row.key}><span>{titleCase(row.key)}</span><i><b style={{ width: `${Math.max(4, row.value / Math.max(1, breakdown.rows[0]?.value || 1) * 100)}%` }} /></i><strong>{integer(row.value)}</strong></div>)}
                  {breakdown.rows.length === 0 ? <p>No populated dimensions were found.</p> : null}
                </div>
              </article>
            ))}
          </section>

          <section className="exo-records" id="extended-records">
            <header>
              <div><span>SERVER-SIDE RECORD EXPLORER</span><h2>{detail.metrics.find((metric) => metric.key === reportKey)?.label || 'Records'}</h2><p>{records ? `${integer(records.total)} matching records` : 'Loading matching records…'}</p></div>
              <div className="exo-record-actions">
                <label><Search size={15} /><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void applySearch()} placeholder="Search all record properties…" /></label>
                <button type="button" onClick={() => void applySearch()} disabled={recordsLoading}>Search</button>
                <a href={exportHref}><Download size={15} />Export up to 25k</a>
              </div>
            </header>
            {recordsLoading ? <div className="exo-state"><LoaderCircle className="exo-spin" />Searching records…</div> : null}
            {!recordsLoading && records ? (
              <div className="exo-record-list">
                {records.results.map((row) => (
                  <article key={row.id}>
                    <div><strong>{recordTitle(row, records.columns)}</strong><small>HubSpot ID {row.id}</small><a href={recordUrl(String(selectedWorkspace?.portal_id || ''), objectType, row.id)} target="_blank" rel="noreferrer">Open in HubSpot <ExternalLink size={12} /></a></div>
                    {records.columns.slice(0, 4).map((column) => <span key={column}><b>{titleCase(column)}</b><small>{row.properties?.[column] || '—'}</small></span>)}
                  </article>
                ))}
                {records.results.length === 0 ? <div className="exo-state">No records match the current report and search.</div> : null}
              </div>
            ) : null}
            <footer>
              <button type="button" disabled={recordsLoading || !records || records.offset === 0} onClick={() => records && void loadRecords(workspaceId, reportKey, Math.max(0, records.offset - records.limit), search)}><ChevronLeft size={15} />Previous</button>
              <span>{records && records.total ? `${records.offset + 1}–${Math.min(records.total, records.offset + records.results.length)} of ${integer(records.total)}` : '0 records'}</span>
              <button type="button" disabled={recordsLoading || !records?.hasMore} onClick={() => records && void loadRecords(workspaceId, reportKey, records.offset + records.limit, search)}>Next<ChevronRight size={15} /></button>
            </footer>
          </section>
        </>
      ) : (
        <div className="exo-state">This object is discovered but has no synchronized records yet.</div>
      )}
    </main>
  );
}
