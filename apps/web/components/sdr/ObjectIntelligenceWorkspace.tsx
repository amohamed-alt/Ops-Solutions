'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
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

import './object-intelligence.css';

type ObjectType = 'contacts' | 'companies' | 'deals' | 'calls' | 'meetings' | 'tasks' | 'tickets';

type WorkspaceRow = {
  workspace: {
    id: string;
    name: string;
    portal_id?: string | number | null;
    hubspot_status?: string;
  };
};

type ObjectOverviewRow = {
  objectType: ObjectType;
  label: string;
  description: string;
  total: number;
  createdInPeriod: number;
  updatedInPeriod: number;
  missingOwner: number;
};

type OverviewPayload = {
  report: {
    generatedAt: string;
    filters: { from: string; to: string; days: number; ownerId?: string | null };
    objects: ObjectOverviewRow[];
  };
};

type ObjectMetric = {
  key: string;
  label: string;
  description: string;
  value: number;
  format: 'number' | 'currency' | 'percent';
  tone: 'neutral' | 'accent' | 'good' | 'warning' | 'critical';
};

type ObjectBreakdown = {
  key: string;
  label: string;
  rows: Array<{ key: string; value: number }>;
};

type DetailPayload = {
  report: {
    generatedAt: string;
    objectType: ObjectType;
    label: string;
    description: string;
    total: number;
    metrics: ObjectMetric[];
    trend: Array<{ day: string; value: number }>;
    breakdowns: ObjectBreakdown[];
    drilldowns: string[];
  };
};

type DrilldownRow = {
  id: string;
  properties: Record<string, string | undefined>;
  hubspotCreatedAt?: string | null;
  hubspotUpdatedAt?: string | null;
  syncedAt?: string | null;
};

type Drilldown = {
  key: string;
  objectType: ObjectType;
  columns: string[];
  limit: number;
  offset: number;
  hasMore: boolean;
  results: DrilldownRow[];
};

type ObjectMeta = {
  label: string;
  shortLabel: string;
  icon: LucideIcon;
};

const OBJECT_META: Record<ObjectType, ObjectMeta> = {
  contacts: { label: 'Contacts', shortLabel: 'People', icon: UsersRound },
  companies: { label: 'Companies', shortLabel: 'Accounts', icon: Building2 },
  deals: { label: 'Deals', shortLabel: 'Revenue', icon: CircleDollarSign },
  calls: { label: 'Calls', shortLabel: 'Calling', icon: Phone },
  meetings: { label: 'Meetings', shortLabel: 'Calendar', icon: CalendarDays },
  tasks: { label: 'Tasks', shortLabel: 'Follow-up', icon: CheckSquare2 },
  tickets: { label: 'Tickets', shortLabel: 'Service', icon: TicketCheck }
};

const HUBSPOT_OBJECT_TYPE_IDS: Record<ObjectType, string> = {
  contacts: '0-1',
  companies: '0-2',
  deals: '0-3',
  tickets: '0-5',
  tasks: '0-27',
  meetings: '0-47',
  calls: '0-48'
};

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultRange() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: dateInput(from), to: dateInput(to) };
}

function integer(value: unknown) {
  return new Intl.NumberFormat('en').format(Number(value ?? 0));
}

function compact(value: unknown) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value ?? 0));
}

function metricValue(metric: ObjectMetric, currency: string) {
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

function queryString(filters: { from: string; to: string }, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams({ ...filters });
  for (const [key, value] of Object.entries(extra)) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  return params.toString();
}

function hubSpotRecordUrl(portalId: string, objectType: ObjectType, recordId: string) {
  const objectTypeId = HUBSPOT_OBJECT_TYPE_IDS[objectType];
  const base = `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}`;
  if (objectType === 'contacts') return `${base}/contact/${encodeURIComponent(recordId)}`;
  if (objectType === 'companies') return `${base}/company/${encodeURIComponent(recordId)}`;
  if (objectType === 'deals') return `${base}/deal/${encodeURIComponent(recordId)}`;
  return `${base}/record/${objectTypeId}/${encodeURIComponent(recordId)}`;
}

function titleCase(value: unknown) {
  return String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ObjectCard({
  row,
  active,
  onSelect
}: {
  row: ObjectOverviewRow;
  active: boolean;
  onSelect: () => void;
}) {
  const meta = OBJECT_META[row.objectType];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className={`oi-object-card${active ? ' active' : ''}`}
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className="oi-object-icon"><Icon size={18} /></span>
      <span className="oi-object-copy">
        <small>{meta.shortLabel}</small>
        <strong>{integer(row.total)}</strong>
        <b>{row.label}</b>
      </span>
      <span className="oi-object-meta">
        <span><b>{integer(row.createdInPeriod)}</b> new</span>
        <span><b>{integer(row.missingOwner)}</b> unowned</span>
      </span>
    </button>
  );
}

function MetricCard({
  metric,
  currency,
  onOpen
}: {
  metric: ObjectMetric;
  currency: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`oi-metric-card oi-tone-${metric.tone}`}
      onClick={onOpen}
      title={`Open ${metric.label} records`}
    >
      <span className="oi-metric-dot" />
      <strong>{metricValue(metric, currency)}</strong>
      <h4>{metric.label}</h4>
      <p>{metric.description}</p>
      <small>View records →</small>
    </button>
  );
}

function recordTitle(objectType: ObjectType, row: DrilldownRow) {
  const p = row.properties || {};
  if (objectType === 'contacts') {
    return {
      title: [p.firstname, p.lastname].filter(Boolean).join(' ') || p.email || `Contact ${row.id}`,
      subtitle: p.email || p.company || 'HubSpot contact'
    };
  }
  if (objectType === 'companies') {
    return { title: p.name || p.domain || `Company ${row.id}`, subtitle: p.domain || p.industry || 'HubSpot company' };
  }
  if (objectType === 'deals') {
    return { title: p.dealname || `Deal ${row.id}`, subtitle: p.amount ? `Amount ${p.amount}` : p.dealstage || 'HubSpot deal' };
  }
  if (objectType === 'calls') {
    return { title: p.hs_call_title || `Call ${row.id}`, subtitle: p.hs_call_status || p.hs_call_disposition || 'HubSpot call' };
  }
  if (objectType === 'meetings') {
    return { title: p.hs_meeting_title || `Meeting ${row.id}`, subtitle: p.hs_meeting_outcome || 'HubSpot meeting' };
  }
  if (objectType === 'tasks') {
    return { title: p.hs_task_subject || `Task ${row.id}`, subtitle: p.hs_task_status || p.hs_task_priority || 'HubSpot task' };
  }
  return { title: p.subject || `Ticket ${row.id}`, subtitle: p.hs_ticket_priority || p.hs_pipeline_stage || 'HubSpot ticket' };
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
    const haystack = `${row.id} ${Object.values(row.properties || {}).join(' ')}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  });

  return (
    <div className="oi-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="oi-drawer" aria-label={`${title} records`}>
        <header>
          <div>
            <span>LIVE HUBSPOT RECORDS</span>
            <h2>{title}</h2>
            <p>Every row opens the original record in HubSpot.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close records"><X size={18} /></button>
        </header>
        <div className="oi-drawer-search">
          <Search size={15} />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search this page…" />
        </div>
        <div className="oi-drawer-body">
          {loading ? <div className="oi-state"><LoaderCircle className="oi-spin" size={22} />Loading records…</div> : null}
          {error ? <div className="oi-state error">{error}</div> : null}
          {!loading && !error && drilldown ? rows.map((row) => {
            const record = recordTitle(drilldown.objectType, row);
            const properties = row.properties || {};
            return (
              <article key={row.id}>
                <span className="oi-record-primary">
                  <strong>{record.title}</strong>
                  <small>{record.subtitle}</small>
                  {portalId ? (
                    <a href={hubSpotRecordUrl(portalId, drilldown.objectType, row.id)} target="_blank" rel="noreferrer">
                      Open in HubSpot <ExternalLink size={12} />
                    </a>
                  ) : null}
                </span>
                <span><b>Owner / status</b><strong>{properties.hubspot_owner_id || properties.hs_activity_assigned_to_user_id || 'Unassigned'}</strong><small>{titleCase(properties.hs_lead_status || properties.hs_task_status || properties.hs_call_status || properties.hs_meeting_outcome || properties.dealstage || properties.hs_pipeline_stage)}</small></span>
                <span><b>Context</b><strong>{properties.company || properties.pipeline || properties.domain || properties.hs_task_priority || '—'}</strong><small>{properties.country || properties.industry || properties.jobtitle || properties.hs_ticket_priority || '—'}</small></span>
                <span><b>Last update</b><strong>{row.hubspotUpdatedAt ? new Date(row.hubspotUpdatedAt).toLocaleDateString() : '—'}</strong><small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleString()}` : 'CRM record'}</small></span>
              </article>
            );
          }) : null}
          {!loading && !error && drilldown && rows.length === 0 ? <div className="oi-state">No records match this page.</div> : null}
        </div>
        <footer>
          <button
            type="button"
            onClick={() => onPage(Math.max(0, (drilldown?.offset ?? 0) - (drilldown?.limit ?? 50)))}
            disabled={loading || !drilldown || drilldown.offset === 0}
          >
            <ChevronLeft size={15} />Previous
          </button>
          <span>{drilldown ? `${drilldown.offset + 1}–${drilldown.offset + drilldown.results.length}` : '—'}</span>
          <button
            type="button"
            onClick={() => onPage((drilldown?.offset ?? 0) + (drilldown?.limit ?? 50))}
            disabled={loading || !drilldown?.hasMore}
          >
            Next<ChevronRight size={15} />
          </button>
        </footer>
      </aside>
    </div>
  );
}

function ObjectDashboard({
  detail,
  detailLoading,
  detailError,
  currency,
  onOpen
}: {
  detail: DetailPayload['report'] | null;
  detailLoading: boolean;
  detailError: string;
  currency: string;
  onOpen: (metric: ObjectMetric) => void;
}) {
  if (detailLoading && !detail) {
    return (
      <div className="oi-detail-skeleton" aria-label="Loading object reports">
        {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
      </div>
    );
  }
  if (detailError && !detail) return <div className="oi-error">{detailError}</div>;
  if (!detail) return null;

  return (
    <>
      {detailError ? <div className="oi-warning">{detailError} Showing the last successful snapshot.</div> : null}
      <div className="oi-section-heading">
        <div>
          <span>OBJECT REPORT PACK</span>
          <h3>{detail.label} intelligence</h3>
          <p>{detail.description}</p>
        </div>
        <b>{detail.metrics.length} live reports</b>
      </div>
      <div className="oi-metric-grid">
        {detail.metrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} currency={currency} onOpen={() => onOpen(metric)} />
        ))}
      </div>
      <div className="oi-analytics-grid">
        <section className="oi-chart-panel oi-trend-panel">
          <header>
            <div><span>CREATION TREND</span><h4>{detail.label} over time</h4></div>
            <b>{integer(detail.trend.reduce((sum, row) => sum + row.value, 0))} in period</b>
          </header>
          <div className="oi-chart">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={detail.trend} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id={`oi-trend-${detail.objectType}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--workspace-accent)" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="var(--workspace-accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8ece8" />
                <XAxis dataKey="day" tick={{ fontSize: 9 }} tickFormatter={(value) => String(value).slice(5)} minTickGap={22} />
                <YAxis tick={{ fontSize: 9 }} allowDecimals={false} />
                <Tooltip formatter={(value) => integer(value)} labelFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString()} />
                <Area type="monotone" dataKey="value" stroke="var(--workspace-accent)" strokeWidth={2.5} fill={`url(#oi-trend-${detail.objectType})`} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        {detail.breakdowns.map((breakdown) => (
          <section className="oi-chart-panel" key={breakdown.key}>
            <header>
              <div><span>BREAKDOWN</span><h4>{breakdown.label}</h4></div>
              <b>{breakdown.rows.length} groups</b>
            </header>
            <div className="oi-chart">
              {breakdown.rows.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdown.rows.slice(0, 8)} layout="vertical" margin={{ top: 6, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef1ed" />
                    <XAxis type="number" hide />
                    <YAxis dataKey="key" type="category" width={100} tick={{ fontSize: 9 }} tickFormatter={(value) => String(value).slice(0, 16)} />
                    <Tooltip formatter={(value) => integer(value)} />
                    <Bar dataKey="value" fill="var(--workspace-accent)" radius={[0, 7, 7, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="oi-state">No grouped data available.</div>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function ObjectIntelligenceWorkspace() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [workspaceRows, setWorkspaceRows] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [portalId, setPortalId] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [filters, setFilters] = useState(defaultRange);
  const [draft, setDraft] = useState(defaultRange);
  const [selectedObject, setSelectedObject] = useState<ObjectType>('contacts');
  const [overview, setOverview] = useState<OverviewPayload['report'] | null>(null);
  const [detail, setDetail] = useState<DetailPayload['report'] | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillTitle, setDrillTitle] = useState('Report records');
  const [drillKey, setDrillKey] = useState('');
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillError, setDrillError] = useState('');
  const [drillSearch, setDrillSearch] = useState('');
  const overviewAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const drillAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    let createdMount: HTMLElement | null = null;
    let createdNav: HTMLButtonElement | null = null;

    function install() {
      if (!active) return;
      const content = document.querySelector<HTMLElement>('.dashboard-workspace-experience .ric-content');
      const nav = document.querySelector<HTMLElement>('.dashboard-workspace-experience .ric-sidebar nav');
      if (content) {
        let target = document.getElementById('object-intelligence');
        if (!target) {
          target = document.createElement('section');
          target.id = 'object-intelligence';
          target.className = 'oi-portal-mount';
          content.append(target);
          createdMount = target;
        }
        setMount(target);
      }
      if (nav && !nav.querySelector('.oi-nav-button')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'oi-nav-button';
        button.innerHTML = '<span class="oi-nav-glyph" aria-hidden="true">◫</span><span>Object intelligence</span><span aria-hidden="true">›</span>';
        button.addEventListener('click', () => document.getElementById('object-intelligence')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        nav.append(button);
        createdNav = button;
      }
    }

    install();
    const observer = new MutationObserver(() => {
      if (!document.getElementById('object-intelligence') || !document.querySelector('.oi-nav-button')) install();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      active = false;
      observer.disconnect();
      createdNav?.remove();
      createdMount?.remove();
      setMount(null);
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/customer/workspaces', { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Unable to load object reporting workspaces.');
        return (payload.results ?? []) as WorkspaceRow[];
      })
      .then((rows) => {
        if (!active) return;
        const connected = rows.filter((row) => row.workspace?.hubspot_status === 'connected');
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = connected.find((row) => row.workspace.id === remembered) ?? connected[0] ?? null;
        setWorkspaceRows(connected);
        setWorkspaceId(selected?.workspace.id ?? '');
        setPortalId(String(selected?.workspace.portal_id ?? ''));
      })
      .catch((error) => {
        if (active) setOverviewError(error instanceof Error ? error.message : 'Unable to load workspaces.');
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function captureWorkspaceChange(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      const row = workspaceRows.find((item) => item.workspace.id === target.value);
      if (!row || row.workspace.id === workspaceId) return;
      setWorkspaceId(row.workspace.id);
      setPortalId(String(row.workspace.portal_id ?? ''));
      setOverview(null);
      setDetail(null);
      setDrilldown(null);
    }
    document.addEventListener('change', captureWorkspaceChange, true);
    return () => document.removeEventListener('change', captureWorkspaceChange, true);
  }, [workspaceId, workspaceRows]);

  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/preferences`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000)
    })
      .then((response) => response.ok ? response.json() : {})
      .then((payload) => setCurrency(String(payload.currency || 'USD')))
      .catch(() => setCurrency('USD'));
  }, [workspaceId]);

  const loadOverview = useCallback(async (nextWorkspaceId: string, nextFilters: { from: string; to: string }) => {
    overviewAbort.current?.abort();
    const controller = new AbortController();
    overviewAbort.current = controller;
    setOverviewLoading(true);
    setOverviewError('');
    try {
      const response = await fetch(
        `/api/dashboard/${encodeURIComponent(nextWorkspaceId)}/objects?${queryString(nextFilters)}`,
        { cache: 'no-store', signal: controller.signal }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to load object summaries.');
      setOverview((payload as OverviewPayload).report);
    } catch (error) {
      if (controller.signal.aborted) return;
      setOverviewError(error instanceof Error ? error.message : 'Object summaries are unavailable.');
    } finally {
      if (overviewAbort.current === controller) {
        overviewAbort.current = null;
        setOverviewLoading(false);
      }
    }
  }, []);

  const loadDetail = useCallback(async (
    nextWorkspaceId: string,
    objectType: ObjectType,
    nextFilters: { from: string; to: string }
  ) => {
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await fetch(
        `/api/dashboard/${encodeURIComponent(nextWorkspaceId)}/objects/${encodeURIComponent(objectType)}?${queryString(nextFilters)}`,
        { cache: 'no-store', signal: controller.signal }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `Unable to load ${objectType} reports.`);
      setDetail((payload as DetailPayload).report);
    } catch (error) {
      if (controller.signal.aborted) return;
      setDetailError(error instanceof Error ? error.message : `${objectType} reports are unavailable.`);
    } finally {
      if (detailAbort.current === controller) {
        detailAbort.current = null;
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void loadOverview(workspaceId, filters);
  }, [filters, loadOverview, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    setDetail(null);
    void loadDetail(workspaceId, selectedObject, filters);
  }, [filters, loadDetail, selectedObject, workspaceId]);

  useEffect(() => () => {
    overviewAbort.current?.abort();
    detailAbort.current?.abort();
    drillAbort.current?.abort();
  }, []);

  const objectRows = useMemo(() => {
    if (overview?.objects?.length) return overview.objects;
    return (Object.keys(OBJECT_META) as ObjectType[]).map((objectType) => ({
      objectType,
      label: OBJECT_META[objectType].label,
      description: '',
      total: 0,
      createdInPeriod: 0,
      updatedInPeriod: 0,
      missingOwner: 0
    }));
  }, [overview]);

  async function openDrilldown(metric: ObjectMetric, offset = 0) {
    if (!workspaceId) return;
    drillAbort.current?.abort();
    const controller = new AbortController();
    drillAbort.current = controller;
    setDrillKey(metric.key);
    setDrillTitle(`${detail?.label || OBJECT_META[selectedObject].label} · ${metric.label}`);
    setDrillLoading(true);
    setDrillError('');
    setDrillSearch('');
    if (offset === 0) {
      setDrilldown({
        key: metric.key,
        objectType: selectedObject,
        columns: [],
        limit: 50,
        offset: 0,
        hasMore: false,
        results: []
      });
    }
    try {
      const response = await fetch(
        `/api/dashboard/${encodeURIComponent(workspaceId)}/objects/${encodeURIComponent(selectedObject)}/drilldowns/${encodeURIComponent(metric.key)}?${queryString(filters, { limit: 50, offset })}`,
        { cache: 'no-store', signal: controller.signal }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to load object records.');
      setDrilldown(payload.drilldown as Drilldown);
    } catch (error) {
      if (controller.signal.aborted) return;
      setDrillError(error instanceof Error ? error.message : 'Object records are unavailable.');
    } finally {
      if (drillAbort.current === controller) {
        drillAbort.current = null;
        setDrillLoading(false);
      }
    }
  }

  function pageDrilldown(offset: number) {
    const metric = detail?.metrics.find((item) => item.key === drillKey);
    if (metric) void openDrilldown(metric, offset);
  }

  function applyFilters() {
    if (!draft.from || !draft.to || draft.from > draft.to) {
      setOverviewError('Choose a valid reporting date range.');
      return;
    }
    setFilters(draft);
  }

  function refreshAll() {
    if (!workspaceId) return;
    void loadOverview(workspaceId, filters);
    void loadDetail(workspaceId, selectedObject, filters);
  }

  function exportSnapshot() {
    if (!detail) return;
    const rows = [
      ['Object', detail.label],
      ['Generated at', detail.generatedAt],
      ['From', filters.from],
      ['To', filters.to],
      [],
      ['Metric', 'Value', 'Description'],
      ...detail.metrics.map((metric) => [metric.label, String(metric.value), metric.description]),
      [],
      ...detail.breakdowns.flatMap((breakdown) => [
        [breakdown.label, 'Count'],
        ...breakdown.rows.map((row) => [row.key, String(row.value)]),
        []
      ])
    ];
    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${detail.objectType}-intelligence-${filters.from}-${filters.to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!mount) return null;

  return createPortal(
    <div className="oi-shell">
      <header className="oi-header">
        <div>
          <span><BarChart3 size={14} />OBJECT INTELLIGENCE</span>
          <h2>Every HubSpot object, organized in one reporting workspace.</h2>
          <p>Explore completeness, workload, pipeline, activities and service records without building reports manually.</p>
        </div>
        <div className="oi-header-actions">
          <label><span>From</span><input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} /></label>
          <label><span>To</span><input type="date" value={draft.to} onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} /></label>
          <button type="button" className="oi-primary" onClick={applyFilters}>Apply</button>
          <button type="button" onClick={refreshAll} disabled={overviewLoading || detailLoading}><RefreshCw className={overviewLoading || detailLoading ? 'oi-spin' : ''} size={15} />Refresh</button>
          <button type="button" onClick={exportSnapshot} disabled={!detail}><Download size={15} />CSV</button>
        </div>
      </header>

      {overviewError ? <div className="oi-error">{overviewError}</div> : null}

      <section className="oi-object-grid" aria-label="HubSpot object reports">
        {objectRows.map((row) => (
          <ObjectCard
            key={row.objectType}
            row={row}
            active={selectedObject === row.objectType}
            onSelect={() => setSelectedObject(row.objectType)}
          />
        ))}
      </section>

      <section className="oi-detail">
        <ObjectDashboard
          detail={detail}
          detailLoading={detailLoading}
          detailError={detailError}
          currency={currency}
          onOpen={(metric) => void openDrilldown(metric)}
        />
      </section>

      <footer className="oi-footer">
        <span><Activity size={14} />Progressive object reports</span>
        <span>{overview?.generatedAt ? `Updated ${new Date(overview.generatedAt).toLocaleString()}` : overviewLoading ? 'Building summaries…' : 'Waiting for workspace data'}</span>
        <span>{workspaceId ? `Workspace ${workspaceId.slice(0, 8)}…` : 'No connected workspace'}</span>
      </footer>

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
    </div>,
    mount
  );
}
