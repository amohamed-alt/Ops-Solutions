'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  ExternalLink,
  LoaderCircle,
  Phone,
  RefreshCw,
  Search,
  TicketCheck,
  UsersRound,
  X,
  type LucideIcon
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import './object-dashboard-page.css';

export const OBJECT_DASHBOARD_TYPES = [
  'contacts',
  'companies',
  'deals',
  'calls',
  'meetings',
  'tasks',
  'tickets'
] as const;

export type ObjectDashboardType = (typeof OBJECT_DASHBOARD_TYPES)[number];

type DateRange = { from: string; to: string };
type WorkspaceRow = {
  workspace: {
    id: string;
    name: string;
    portal_id?: string | number | null;
    hubspot_status?: string;
  };
};
type Metric = {
  key: string;
  label: string;
  description: string;
  value: number;
  format: 'number' | 'currency' | 'percent';
  tone: 'neutral' | 'accent' | 'good' | 'warning' | 'critical';
};
type Breakdown = { key: string; label: string; rows: Array<{ key: string; value: number }> };
type ObjectReport = {
  generatedAt: string;
  objectType: ObjectDashboardType;
  label: string;
  description: string;
  total: number;
  metrics: Metric[];
  trend: Array<{ day: string; value: number }>;
  breakdowns: Breakdown[];
  drilldowns: string[];
};
type DrilldownRow = {
  id: string;
  properties: Record<string, string | undefined>;
  hubspotUpdatedAt?: string | null;
  syncedAt?: string | null;
};
type Drilldown = {
  key: string;
  objectType: ObjectDashboardType;
  limit: number;
  offset: number;
  hasMore: boolean;
  results: DrilldownRow[];
};
type ObjectMeta = {
  label: string;
  description: string;
  icon: LucideIcon;
  hubspotObjectTypeId: string;
};

const META: Record<ObjectDashboardType, ObjectMeta> = {
  contacts: {
    label: 'Contacts',
    description: 'Lead coverage, completeness, engagement and conversion readiness.',
    icon: UsersRound,
    hubspotObjectTypeId: '0-1'
  },
  companies: {
    label: 'Companies',
    description: 'Account segmentation, ownership, enrichment and commercial coverage.',
    icon: Building2,
    hubspotObjectTypeId: '0-2'
  },
  deals: {
    label: 'Deals',
    description: 'Pipeline, revenue, risk, conversion and association coverage.',
    icon: CircleDollarSign,
    hubspotObjectTypeId: '0-3'
  },
  calls: {
    label: 'Calls',
    description: 'Calling execution, dispositions, ownership and contact coverage.',
    icon: Phone,
    hubspotObjectTypeId: '0-48'
  },
  meetings: {
    label: 'Meetings',
    description: 'Booked meetings, completion, no-shows, notes and follow-up quality.',
    icon: CalendarDays,
    hubspotObjectTypeId: '0-47'
  },
  tasks: {
    label: 'Tasks',
    description: 'Follow-up workload, overdue actions, priorities and completion.',
    icon: CheckSquare2,
    hubspotObjectTypeId: '0-27'
  },
  tickets: {
    label: 'Tickets',
    description: 'Service workload, pipeline stages, priorities and resolution readiness.',
    icon: TicketCheck,
    hubspotObjectTypeId: '0-5'
  }
};

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: dateInput(from), to: dateInput(to) };
}

function paramsFor(range: DateRange, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams(range);
  for (const [key, value] of Object.entries(extra)) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  return params.toString();
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) {
    const error = new Error(payload.message || 'Unable to load dashboard data.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function integer(value: unknown) {
  return new Intl.NumberFormat('en').format(Number(value ?? 0));
}

function compact(value: unknown) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function metricValue(metric: Metric, currency: string) {
  if (metric.format === 'percent') return `${Number(metric.value || 0).toFixed(1)}%`;
  if (metric.format === 'currency') {
    try {
      return new Intl.NumberFormat('en', {
        style: 'currency',
        currency: currency || 'USD',
        notation: 'compact',
        maximumFractionDigits: 1
      }).format(Number(metric.value || 0));
    } catch {
      return compact(metric.value);
    }
  }
  return integer(metric.value);
}

function titleCase(value: unknown) {
  return String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hubSpotUrl(portalId: string, objectType: ObjectDashboardType, recordId: string) {
  const base = `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}`;
  if (objectType === 'contacts') return `${base}/contact/${encodeURIComponent(recordId)}`;
  if (objectType === 'companies') return `${base}/company/${encodeURIComponent(recordId)}`;
  if (objectType === 'deals') return `${base}/deal/${encodeURIComponent(recordId)}`;
  return `${base}/record/${META[objectType].hubspotObjectTypeId}/${encodeURIComponent(recordId)}`;
}

function recordLabel(objectType: ObjectDashboardType, row: DrilldownRow) {
  const p = row.properties || {};
  if (objectType === 'contacts') return {
    title: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || `Contact ${row.id}`,
    subtitle: p.email || p.company || 'HubSpot contact'
  };
  if (objectType === 'companies') return {
    title: p.name || p.domain || `Company ${row.id}`,
    subtitle: p.domain || p.industry || 'HubSpot company'
  };
  if (objectType === 'deals') return {
    title: p.dealname || `Deal ${row.id}`,
    subtitle: p.amount ? `Amount ${p.amount}` : p.dealstage || 'HubSpot deal'
  };
  if (objectType === 'calls') return {
    title: p.hs_call_title || `Call ${row.id}`,
    subtitle: p.hs_call_status || p.hs_call_disposition || 'HubSpot call'
  };
  if (objectType === 'meetings') return {
    title: p.hs_meeting_title || `Meeting ${row.id}`,
    subtitle: p.hs_meeting_outcome || 'HubSpot meeting'
  };
  if (objectType === 'tasks') return {
    title: p.hs_task_subject || `Task ${row.id}`,
    subtitle: p.hs_task_status || p.hs_task_priority || 'HubSpot task'
  };
  return {
    title: p.subject || `Ticket ${row.id}`,
    subtitle: p.hs_ticket_priority || p.hs_pipeline_stage || 'HubSpot ticket'
  };
}

function MetricCard({ metric, currency, onOpen }: { metric: Metric; currency: string; onOpen: () => void }) {
  return (
    <button type="button" className={`odp-metric odp-tone-${metric.tone}`} onClick={onOpen}>
      <span className="odp-metric-dot" />
      <strong>{metricValue(metric, currency)}</strong>
      <h3>{metric.label}</h3>
      <p>{metric.description}</p>
      <small>Inspect records →</small>
    </button>
  );
}

function DrilldownDrawer({
  drilldown,
  title,
  portalId,
  loading,
  error,
  search,
  onSearch,
  onClose,
  onPage
}: {
  drilldown: Drilldown | null;
  title: string;
  portalId: string;
  loading: boolean;
  error: string;
  search: string;
  onSearch: (value: string) => void;
  onClose: () => void;
  onPage: (offset: number) => void;
}) {
  if (!drilldown && !loading && !error) return null;
  const rows = (drilldown?.results ?? []).filter((row) => {
    if (!search.trim()) return true;
    return `${row.id} ${Object.values(row.properties || {}).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <div className="odp-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="odp-drawer" aria-label={`${title} records`}>
        <header>
          <div><span>LIVE HUBSPOT RECORDS</span><h2>{title}</h2><p>Search, paginate and open the original CRM record.</p></div>
          <button type="button" onClick={onClose} aria-label="Close records"><X size={18} /></button>
        </header>
        <label className="odp-drawer-search"><Search size={15} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search this page…" /></label>
        <div className="odp-drawer-body">
          {loading ? <div className="odp-state"><LoaderCircle className="odp-spin" size={22} />Loading records…</div> : null}
          {error ? <div className="odp-state error">{error}</div> : null}
          {!loading && !error && drilldown ? rows.map((row) => {
            const label = recordLabel(drilldown.objectType, row);
            const p = row.properties || {};
            return (
              <article key={row.id}>
                <span className="odp-record-main">
                  <strong>{label.title}</strong>
                  <small>{label.subtitle}</small>
                  {portalId ? <a href={hubSpotUrl(portalId, drilldown.objectType, row.id)} target="_blank" rel="noreferrer">Open in HubSpot <ExternalLink size={12} /></a> : null}
                </span>
                <span><b>Owner / status</b><strong>{p.hubspot_owner_id || p.hs_activity_assigned_to_user_id || 'Unassigned'}</strong><small>{titleCase(p.hs_lead_status || p.hs_task_status || p.hs_call_status || p.hs_meeting_outcome || p.dealstage || p.hs_pipeline_stage)}</small></span>
                <span><b>Context</b><strong>{p.company || p.pipeline || p.domain || p.hs_task_priority || '—'}</strong><small>{p.country || p.industry || p.jobtitle || p.hs_ticket_priority || '—'}</small></span>
                <span><b>Last update</b><strong>{row.hubspotUpdatedAt ? new Date(row.hubspotUpdatedAt).toLocaleDateString() : '—'}</strong><small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleString()}` : 'CRM record'}</small></span>
              </article>
            );
          }) : null}
          {!loading && !error && drilldown && rows.length === 0 ? <div className="odp-state">No records match this page.</div> : null}
        </div>
        <footer>
          <button type="button" onClick={() => onPage(Math.max(0, (drilldown?.offset ?? 0) - (drilldown?.limit ?? 50)))} disabled={loading || !drilldown || drilldown.offset === 0}><ChevronLeft size={15} />Previous</button>
          <span>{drilldown ? `${drilldown.offset + 1}–${drilldown.offset + drilldown.results.length}` : '—'}</span>
          <button type="button" onClick={() => onPage((drilldown?.offset ?? 0) + (drilldown?.limit ?? 50))} disabled={loading || !drilldown?.hasMore}>Next<ChevronRight size={15} /></button>
        </footer>
      </aside>
    </div>
  );
}

export function ObjectDashboardPageClient({ objectType }: { objectType: ObjectDashboardType }) {
  const router = useRouter();
  const meta = META[objectType];
  const Icon = meta.icon;
  const initial = useMemo(defaultRange, []);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [portalId, setPortalId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [filters, setFilters] = useState<DateRange>(initial);
  const [draft, setDraft] = useState<DateRange>(initial);
  const [report, setReport] = useState<ObjectReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillKey, setDrillKey] = useState('');
  const [drillTitle, setDrillTitle] = useState('Report records');
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState('');
  const [drillSearch, setDrillSearch] = useState('');
  const reportAbort = useRef<AbortController | null>(null);
  const drillAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    fetchJson<{ results?: WorkspaceRow[] }>('/api/customer/workspaces', { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      .then((payload) => {
        if (!active) return;
        const rows = (payload.results ?? []).filter((row) => row.workspace?.hubspot_status === 'connected');
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((row) => row.workspace.id === remembered) ?? rows[0] ?? null;
        setWorkspaces(rows);
        setWorkspaceId(selected?.workspace.id ?? '');
        setPortalId(String(selected?.workspace.portal_id ?? ''));
        if (!selected) setError('No connected HubSpot workspace is available.');
      })
      .catch((caught: Error & { status?: number }) => {
        if (!active) return;
        if (caught.status === 401) router.replace('/onboarding');
        else setError(caught.message);
      });
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!workspaceId) return;
    fetchJson<{ currency?: string }>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/preferences`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    }).then((payload) => setCurrency(String(payload.currency || 'USD'))).catch(() => setCurrency('USD'));
  }, [workspaceId]);

  const loadReport = useCallback(async (nextWorkspaceId: string, range: DateRange) => {
    reportAbort.current?.abort();
    const controller = new AbortController();
    reportAbort.current = controller;
    setLoading(true);
    setError('');
    try {
      const payload = await fetchJson<{ report: ObjectReport }>(
        `/api/dashboard/${encodeURIComponent(nextWorkspaceId)}/objects/${encodeURIComponent(objectType)}?${paramsFor(range)}`,
        { cache: 'no-store', signal: controller.signal }
      );
      setReport(payload.report);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'The object report is unavailable.');
    } finally {
      if (reportAbort.current === controller) {
        reportAbort.current = null;
        setLoading(false);
      }
    }
  }, [objectType]);

  useEffect(() => {
    if (workspaceId) void loadReport(workspaceId, filters);
  }, [filters, loadReport, workspaceId]);

  useEffect(() => () => {
    reportAbort.current?.abort();
    drillAbort.current?.abort();
  }, []);

  function selectWorkspace(nextId: string) {
    const row = workspaces.find((item) => item.workspace.id === nextId);
    setWorkspaceId(nextId);
    setPortalId(String(row?.workspace.portal_id ?? ''));
    setReport(null);
    setDrilldown(null);
    window.localStorage.setItem('ops:last-dashboard-workspace', nextId);
  }

  function applyFilters() {
    if (!draft.from || !draft.to || draft.from > draft.to) {
      setError('Choose a valid reporting date range.');
      return;
    }
    setFilters(draft);
  }

  async function openDrilldown(metric: Metric, offset = 0) {
    if (!workspaceId) return;
    drillAbort.current?.abort();
    const controller = new AbortController();
    drillAbort.current = controller;
    setDrillKey(metric.key);
    setDrillTitle(`${report?.label || meta.label} · ${metric.label}`);
    setDrillLoading(true);
    setDrillError('');
    setDrillSearch('');
    if (offset === 0) setDrilldown({ key: metric.key, objectType, limit: 50, offset: 0, hasMore: false, results: [] });
    try {
      const payload = await fetchJson<{ drilldown: Drilldown }>(
        `/api/dashboard/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(objectType)}/drilldowns/${encodeURIComponent(metric.key)}?${paramsFor(filters, { limit: 50, offset })}`,
        { cache: 'no-store', signal: controller.signal }
      );
      setDrilldown(payload.drilldown);
    } catch (caught) {
      if (!controller.signal.aborted) setDrillError(caught instanceof Error ? caught.message : 'Records are unavailable.');
    } finally {
      if (drillAbort.current === controller) {
        drillAbort.current = null;
        setDrillLoading(false);
      }
    }
  }

  function pageDrilldown(offset: number) {
    const metric = report?.metrics.find((item) => item.key === drillKey);
    if (metric) void openDrilldown(metric, offset);
  }

  function exportSnapshot() {
    if (!report) return;
    const rows: string[][] = [
      ['Object', report.label],
      ['Workspace', workspaceId],
      ['Generated at', report.generatedAt],
      ['From', filters.from],
      ['To', filters.to],
      [],
      ['Metric', 'Value', 'Description'],
      ...report.metrics.map((metric) => [metric.label, String(metric.value), metric.description]),
      [],
      ...report.breakdowns.flatMap((breakdown) => [[breakdown.label, 'Count'], ...breakdown.rows.map((row) => [row.key, String(row.value)]), []])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${objectType}-dashboard-${filters.from}-${filters.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="odp-page">
      <header className="odp-topbar">
        <Link href="/dashboard"><ArrowLeft size={16} />Revenue command center</Link>
        <nav aria-label="Object dashboards">
          {OBJECT_DASHBOARD_TYPES.map((type) => {
            const NavIcon = META[type].icon;
            return <Link key={type} className={type === objectType ? 'active' : ''} href={`/dashboard/objects/${type}`}><NavIcon size={14} />{META[type].label}</Link>;
          })}
        </nav>
      </header>

      <section className="odp-hero">
        <div className="odp-hero-icon"><Icon size={25} /></div>
        <div><span>OBJECT COMMAND CENTER</span><h1>{meta.label} dashboard</h1><p>{report?.description || meta.description}</p></div>
        <div className="odp-hero-summary">
          <small>Live records</small>
          <strong>{report ? integer(report.total) : '—'}</strong>
          <span>{report?.generatedAt ? `Updated ${new Date(report.generatedAt).toLocaleString()}` : 'Loading synchronized data'}</span>
        </div>
      </section>

      <section className="odp-controls">
        <label><span>Workspace</span><select value={workspaceId} onChange={(event) => selectWorkspace(event.target.value)}>{workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}</select></label>
        <label><span>From</span><input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
        <label><span>To</span><input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
        <button type="button" className="primary" onClick={applyFilters}>Apply filters</button>
        <button type="button" onClick={() => workspaceId && void loadReport(workspaceId, filters)} disabled={!workspaceId || loading}><RefreshCw className={loading ? 'odp-spin' : ''} size={15} />Refresh</button>
        <button type="button" onClick={exportSnapshot} disabled={!report}><Download size={15} />CSV</button>
      </section>

      {error ? <div className="odp-error">{error}</div> : null}
      {loading && !report ? <div className="odp-skeleton">{Array.from({ length: 8 }, (_, index) => <span key={index} />)}</div> : null}

      {report ? (
        <>
          <section className="odp-metrics">
            {report.metrics.map((metric) => <MetricCard key={metric.key} metric={metric} currency={currency} onOpen={() => void openDrilldown(metric)} />)}
          </section>
          <section className="odp-analytics">
            <article className="odp-chart wide">
              <header><div><span><Activity size={14} />CREATION TREND</span><h2>{meta.label} created over time</h2></div><b>{integer(report.trend.reduce((sum, row) => sum + row.value, 0))} in period</b></header>
              <div>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={report.trend} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
                    <defs><linearGradient id={`odp-${objectType}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0f766e" stopOpacity={0.28} /><stop offset="95%" stopColor="#0f766e" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e6ece9" />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(value) => String(value).slice(5)} minTickGap={24} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip formatter={(value) => integer(value)} labelFormatter={(value) => new Date(`${String(value)}T00:00:00`).toLocaleDateString()} />
                    <Area type="monotone" dataKey="value" stroke="#0f766e" strokeWidth={2.5} fill={`url(#odp-${objectType})`} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </article>
            {report.breakdowns.map((breakdown) => (
              <article className="odp-chart" key={breakdown.key}>
                <header><div><span><BarChart3 size={14} />BREAKDOWN</span><h2>{breakdown.label}</h2></div><b>{breakdown.rows.length} groups</b></header>
                <div>
                  {breakdown.rows.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={breakdown.rows.slice(0, 10)} layout="vertical" margin={{ top: 6, right: 14, left: 4, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#edf1ef" /><XAxis type="number" hide /><YAxis dataKey="key" type="category" width={110} tick={{ fontSize: 9 }} tickFormatter={(value) => String(value).slice(0, 18)} /><Tooltip formatter={(value) => integer(value)} /><Bar dataKey="value" fill="#0f766e" radius={[0, 7, 7, 0]} /></BarChart></ResponsiveContainer> : <div className="odp-state">No grouped data available.</div>}
                </div>
              </article>
            ))}
          </section>
        </>
      ) : null}

      <footer className="odp-footer"><span><Activity size={14} />Tenant-isolated synchronized HubSpot analytics</span><span>{workspaceId ? `Workspace ${workspaceId.slice(0, 8)}…` : 'Waiting for workspace'}</span></footer>

      <DrilldownDrawer
        drilldown={drilldown}
        title={drillTitle}
        portalId={portalId}
        loading={drillLoading}
        error={drillError}
        search={drillSearch}
        onSearch={setDrillSearch}
        onClose={() => {
          drillAbort.current?.abort();
          setDrilldown(null);
          setDrillError('');
          setDrillSearch('');
        }}
        onPage={pageDrilldown}
      />
    </main>
  );
}
