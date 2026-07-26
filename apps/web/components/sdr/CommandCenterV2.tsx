'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Globe2,
  LayoutDashboard,
  ListTodo,
  LoaderCircle,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Target,
  Trash2,
  TrendingUp,
  UserRoundSearch,
  UsersRound,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import type { WorkspaceState } from './types';
import './command-center-v2.css';

type CommandRole = 'executive' | 'manager' | 'sdr' | 'revops';
type DashboardTab = 'overview' | 'pipeline' | 'acquisition' | 'team' | 'quality';
type DatePreset = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'previous_month' | 'this_quarter' | 'this_year' | 'custom';

type Filters = {
  from: string;
  to: string;
  ownerId: string;
  country: string;
  pipelineId: string;
  stageId: string;
  leadSource: string;
};

type Comparison = {
  current: number;
  previous: number;
  deltaPercent: number | null;
};

type Report = {
  generatedAt: string;
  filters: Filters & { days: number };
  comparisonPeriod: { from: string; to: string };
  filterOptions: {
    owners: Array<{ id: string; label: string; email?: string | null }>;
    countries: Array<{ value: string; count: number }>;
    pipelines: Array<{ id: string; label: string }>;
    stages: Array<{ id: string; pipelineId: string; label: string }>;
    leadSources: Array<{ value: string; count: number }>;
  };
  overview: Record<string, number>;
  comparisons: Record<string, Comparison>;
  activityTrend: Array<{ day: string; calls: number; meetings: number; tasks: number }>;
  pipelineByStage: Array<{
    pipelineId: string;
    stageId: string;
    pipelineLabel: string;
    stageLabel: string;
    deals: number;
    amount: number;
  }>;
  leadSourcePerformance: Array<{
    key: string;
    contacts: number;
    contacted: number;
    opportunities: number;
    won: number;
    winRate: number;
  }>;
  countryDistribution: Array<{ key: string; value: number }>;
  ownerPerformance: Array<{
    ownerId: string;
    ownerName: string;
    email?: string | null;
    calls: number;
    meetings: number;
    tasks: number;
    openDeals: number;
    openPipeline: number;
    wonRevenue: number;
    meetingRate: number;
  }>;
  outcomes: Record<'calls' | 'meetings' | 'tasks', Array<{ key: string; value: number }>>;
  dataQuality: {
    totalContacts: number;
    score: number;
    fields: Array<{ key: string; complete: number; missing: number; percentage: number }>;
  };
  attention: Record<string, number>;
};

type RevenuePayload = {
  workspace: WorkspaceState['workspace'];
  report: Report;
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
  objectType: string;
  columns: string[];
  limit: number;
  offset: number;
  hasMore: boolean;
  results: DrilldownRow[];
};

type SavedView = {
  id: string;
  name: string;
  datePreset: DatePreset;
  filters: {
    from?: string | null;
    to?: string | null;
    ownerId?: string | null;
    country?: string | null;
    leadSource?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
  };
  section: string;
  isDefault: boolean;
};

type Kpi = {
  label: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  tone: string;
  comparison?: Comparison;
  amount?: boolean;
  percent?: boolean;
  drilldown?: string;
};

type RoleMeta = {
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
};

const ROLE_META: Record<CommandRole, RoleMeta> = {
  executive: {
    label: 'Executive Command Center',
    shortLabel: 'Executive',
    description: 'Revenue, pipeline coverage, commercial risk and leadership decisions.',
    icon: Gauge
  },
  manager: {
    label: 'Sales Manager Workspace',
    shortLabel: 'Manager',
    description: 'Team execution, conversion, pipeline movement and interventions.',
    icon: UsersRound
  },
  sdr: {
    label: 'SDR Workspace',
    shortLabel: 'SDR',
    description: 'Priority outreach, completed conversations and overdue actions.',
    icon: UserRoundSearch
  },
  revops: {
    label: 'Revenue Operations',
    shortLabel: 'RevOps',
    description: 'CRM quality, synchronization health and operational readiness.',
    icon: Wrench
  }
};

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'custom', label: 'Custom range' }
];

const PIE_COLORS = ['#087a50', '#3a7de0', '#d98d25', '#744bc4', '#1aa6a0', '#df5a4b', '#6a7d75', '#f1bd28'];
const HUBSPOT_OBJECT_IDS: Record<string, string> = {
  contacts: '0-1', companies: '0-2', deals: '0-3', tickets: '0-5', tasks: '0-27', meetings: '0-47', calls: '0-48'
};

function dateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeForPreset(preset: DatePreset, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = new Date(end);
  let to = new Date(end);
  if (preset === 'yesterday') {
    start.setDate(start.getDate() - 1);
    to = new Date(start);
  } else if (preset === 'last_7_days') {
    start.setDate(start.getDate() - 6);
  } else if (preset === 'this_month') {
    start = new Date(end.getFullYear(), end.getMonth(), 1);
  } else if (preset === 'previous_month') {
    start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
    to = new Date(end.getFullYear(), end.getMonth(), 0);
  } else if (preset === 'this_quarter') {
    start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
  } else if (preset === 'this_year') {
    start = new Date(end.getFullYear(), 0, 1);
  } else if (preset === 'last_30_days' || preset === 'custom') {
    start.setDate(start.getDate() - 29);
  }
  return { from: dateInput(start), to: dateInput(to) };
}

const DEFAULT_PRESET: DatePreset = 'last_30_days';
const DEFAULT_RANGE = rangeForPreset(DEFAULT_PRESET);
const DEFAULT_FILTERS: Filters = {
  from: DEFAULT_RANGE.from,
  to: DEFAULT_RANGE.to,
  ownerId: '',
  country: '',
  pipelineId: '',
  stageId: '',
  leadSource: ''
};

function integer(value: unknown) {
  return new Intl.NumberFormat('en-US').format(Number(value ?? 0));
}

function compact(value: unknown) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function percentage(value: unknown) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function titleCase(value: unknown) {
  return String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function queryString(filters: Filters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  return params.toString();
}

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) {
    const error = new Error(payload.message || `Request failed with ${response.status}.`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return payload;
}

function filtersFromView(view: SavedView): Filters {
  const range = view.datePreset === 'custom' && view.filters.from && view.filters.to
    ? { from: view.filters.from, to: view.filters.to }
    : rangeForPreset(view.datePreset);
  return {
    ...range,
    ownerId: view.filters.ownerId ?? '',
    country: view.filters.country ?? '',
    pipelineId: view.filters.pipelineId ?? '',
    stageId: view.filters.stageId ?? '',
    leadSource: view.filters.leadSource ?? ''
  };
}

function tabFromSection(section: string): DashboardTab {
  if (section === 'pipeline') return 'pipeline';
  if (section === 'activity' || section === 'sources') return 'acquisition';
  if (section === 'team') return 'team';
  if (section === 'quality') return 'quality';
  return 'overview';
}

function sectionFromTab(tab: DashboardTab) {
  if (tab === 'acquisition') return 'sources';
  return tab;
}

function recordUrl(portalId: string | number | null | undefined, objectType: string, recordId: string) {
  if (!portalId) return null;
  const normalized = objectType.toLowerCase().replace(/s$/, '') + 's';
  const base = `https://app.hubspot.com/contacts/${encodeURIComponent(String(portalId))}`;
  if (normalized === 'contacts') return `${base}/contact/${encodeURIComponent(recordId)}`;
  if (normalized === 'companies') return `${base}/company/${encodeURIComponent(recordId)}`;
  if (normalized === 'deals') return `${base}/deal/${encodeURIComponent(recordId)}`;
  const objectId = HUBSPOT_OBJECT_IDS[normalized];
  return objectId ? `${base}/record/${objectId}/${encodeURIComponent(recordId)}` : null;
}

function recordLabel(row: DrilldownRow) {
  const p = row.properties || {};
  const name = [p.firstname, p.lastname].filter(Boolean).join(' ')
    || p.dealname
    || p.name
    || p.hs_task_subject
    || p.hs_call_title
    || p.hs_meeting_title
    || `Record ${row.id}`;
  const detail = p.email || p.company || p.jobtitle || p.hs_task_status || p.hs_call_status || p.hs_meeting_outcome || `HubSpot ID ${row.id}`;
  return { name, detail };
}

function Panel({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="cc2-panel ric-panel">
      <header><div><h2>{title}</h2><p>{description}</p></div>{action}</header>
      <div className="cc2-panel-body">{children}</div>
    </section>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="cc2-tooltip">
      {label ? <strong>{label}</strong> : null}
      {payload.map((row: any, index: number) => (
        <span key={`${row.dataKey || row.name}-${index}`}><i style={{ background: row.color }} />{titleCase(row.name || row.dataKey)}<b>{compact(row.value)}</b></span>
      ))}
    </div>
  );
}

function KpiCard({ item, onOpen }: { item: Kpi; onOpen: (key: string, title: string) => void }) {
  const Icon = item.icon;
  const value = item.percent ? percentage(item.value) : item.amount ? compact(item.value) : integer(item.value);
  const content = (
    <>
      <div className="cc2-kpi-top"><span><Icon size={17} /></span>{item.comparison ? <b className={item.comparison.deltaPercent !== null && item.comparison.deltaPercent < 0 ? 'down' : 'up'}>{item.comparison.deltaPercent === null ? 'New' : `${Math.abs(item.comparison.deltaPercent).toFixed(1)}%`}</b> : <b>Snapshot</b>}</div>
      <strong>{value}</strong><h3>{item.label}</h3><p>{item.helper}</p>
    </>
  );
  return item.drilldown
    ? <button className={`cc2-kpi ric-kpi tone-${item.tone}`} onClick={() => onOpen(item.drilldown!, item.label)}>{content}</button>
    : <article className={`cc2-kpi ric-kpi tone-${item.tone}`}>{content}</article>;
}

function OutcomeList({ rows }: { rows: Array<{ key: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <div className="cc2-empty">No records match the current filters.</div>;
  return (
    <div className="cc2-outcomes">
      {rows.slice(0, 8).map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.value)}</span></div><i><b style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></i></article>)}
    </div>
  );
}

function NavigationGroup({ id, label, icon: Icon, open, onToggle, children }: { id: string; label: string; icon: LucideIcon; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <section className={`cc2-nav-group ${open ? 'open' : ''}`}>
      <button type="button" onClick={() => onToggle(id)}><Icon size={17} /><span>{label}</span><ChevronDown size={14} /></button>
      {open ? <div>{children}</div> : null}
    </section>
  );
}

export function CommandCenterV2() {
  const router = useRouter();
  const requestVersion = useRef(0);
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState<RevenuePayload | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [datePreset, setDatePreset] = useState<DatePreset>(DEFAULT_PRESET);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [commandRole, setCommandRole] = useState<CommandRole>('executive');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ revenue: true, acquisition: false, crm: false, admin: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillTitle, setDrillTitle] = useState('Report details');
  const [drillKey, setDrillKey] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [viewBusy, setViewBusy] = useState('');

  const selectedState = useMemo(() => workspaces.find((row) => row.workspace.id === selectedId) ?? null, [workspaces, selectedId]);
  const workspace = payload?.workspace ?? selectedState?.workspace ?? null;
  const report = payload?.report ?? null;
  const role = ROLE_META[commandRole];
  const stages = useMemo(() => (report?.filterOptions.stages ?? []).filter((row) => !draft.pipelineId || row.pipelineId === draft.pipelineId), [report, draft.pipelineId]);

  async function loadReport(workspaceId: string, nextFilters: Filters) {
    const version = ++requestVersion.current;
    const result = await json<RevenuePayload>(`/api/dashboard/${encodeURIComponent(workspaceId)}/reports?${queryString(nextFilters)}`);
    if (version === requestVersion.current) setPayload(result);
    return result;
  }

  async function loadViews(workspaceId: string) {
    const result = await json<{ results?: SavedView[] }>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views`).catch(() => ({ results: [] }));
    const rows = result.results ?? [];
    setSavedViews(rows);
    return rows;
  }

  useEffect(() => {
    const rememberedRole = window.localStorage.getItem('ops:dashboard-command-role') as CommandRole | null;
    if (rememberedRole && rememberedRole in ROLE_META) setCommandRole(rememberedRole);
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const result = await json<{ results?: WorkspaceState[] }>('/api/customer/workspaces');
        const rows = (result.results ?? []).filter((row) => row.workspace.hubspot_status === 'connected');
        if (!rows.length) {
          router.replace('/onboarding');
          return;
        }
        const rememberedWorkspace = window.localStorage.getItem('ops:last-dashboard-workspace');
        const selected = rows.find((row) => row.workspace.id === rememberedWorkspace) ?? rows[0];
        if (!active) return;
        setWorkspaces(rows);
        setSelectedId(selected.workspace.id);
        const views = await loadViews(selected.workspace.id);
        const defaultView = views.find((view) => view.isDefault);
        const initialFilters = defaultView ? filtersFromView(defaultView) : DEFAULT_FILTERS;
        if (!active) return;
        setFilters(initialFilters);
        setDraft(initialFilters);
        setDatePreset(defaultView?.datePreset ?? DEFAULT_PRESET);
        setActiveTab(defaultView ? tabFromSection(defaultView.section) : 'overview');
        await loadReport(selected.workspace.id, initialFilters);
      } catch (reason) {
        const typed = reason as Error & { status?: number };
        if (typed.status === 401) router.replace('/onboarding');
        else if (active) setError(typed.message || 'Unable to load the command center.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; requestVersion.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function changeWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === selectedId) return;
    setSelectedId(workspaceId);
    setPayload(null);
    setDrilldown(null);
    setError('');
    setLoading(true);
    window.localStorage.setItem('ops:last-dashboard-workspace', workspaceId);
    try {
      const views = await loadViews(workspaceId);
      const defaultView = views.find((view) => view.isDefault);
      const nextFilters = defaultView ? filtersFromView(defaultView) : DEFAULT_FILTERS;
      setFilters(nextFilters);
      setDraft(nextFilters);
      setDatePreset(defaultView?.datePreset ?? DEFAULT_PRESET);
      setActiveTab(defaultView ? tabFromSection(defaultView.section) : 'overview');
      await loadReport(workspaceId, nextFilters);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load this workspace.');
    } finally {
      setLoading(false);
    }
  }

  async function applyFilters() {
    if (!selectedId) return;
    const nextFilters = datePreset === 'custom' ? draft : { ...draft, ...rangeForPreset(datePreset) };
    if (!nextFilters.from || !nextFilters.to || nextFilters.from > nextFilters.to) {
      setError('Choose a valid reporting start and end date.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      setFilters(nextFilters);
      setDraft(nextFilters);
      await loadReport(selectedId, nextFilters);
      setFiltersOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to apply filters.');
    } finally {
      setLoading(false);
    }
  }

  async function resetFilters() {
    if (!selectedId) return;
    setDatePreset(DEFAULT_PRESET);
    setDraft(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setLoading(true);
    try {
      await loadReport(selectedId, DEFAULT_FILTERS);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reset filters.');
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    try {
      const state = await json<{ results?: WorkspaceState[] }>('/api/customer/workspaces');
      setWorkspaces((state.results ?? []).filter((row) => row.workspace.hubspot_status === 'connected'));
      await loadReport(selectedId, filters);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to refresh the dashboard.');
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    if (!selectedId || exporting) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/dashboard/${encodeURIComponent(selectedId)}/export?${queryString(filters)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to export this report.');
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'revenue-report.csv';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.replace(/[^a-z0-9._-]+/gi, '-');
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to export this report.');
    } finally {
      setExporting(false);
    }
  }

  async function loadDrilldown(key: string, title: string, offset = 0) {
    if (!selectedId) return;
    setDrillKey(key);
    setDrillTitle(title);
    setLoading(true);
    try {
      const result = await json<{ drilldown: Drilldown }>(`/api/dashboard/${encodeURIComponent(selectedId)}/reports/${encodeURIComponent(key)}?${queryString(filters, { limit: 50, offset })}`);
      setDrilldown(result.drilldown);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load report details.');
    } finally {
      setLoading(false);
    }
  }

  async function createView() {
    const name = viewName.trim().replace(/\s+/g, ' ');
    if (!name || !selectedId) return;
    setViewBusy('create');
    try {
      const created = await json<SavedView>(`/api/customer/workspaces/${encodeURIComponent(selectedId)}/saved-views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          datePreset,
          filters: {
            from: datePreset === 'custom' ? filters.from : '',
            to: datePreset === 'custom' ? filters.to : '',
            ownerId: filters.ownerId || null,
            country: filters.country || null,
            leadSource: filters.leadSource || null,
            pipelineId: filters.pipelineId || null,
            stageId: filters.stageId || null
          },
          section: sectionFromTab(activeTab),
          widgetConfiguration: null
        })
      });
      setSavedViews((rows) => [created, ...rows]);
      setViewName('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save this view.');
    } finally {
      setViewBusy('');
    }
  }

  async function applyView(view: SavedView) {
    if (!selectedId) return;
    setViewBusy(view.id);
    const nextFilters = filtersFromView(view);
    try {
      setDatePreset(view.datePreset);
      setFilters(nextFilters);
      setDraft(nextFilters);
      setActiveTab(tabFromSection(view.section));
      await loadReport(selectedId, nextFilters);
      setViewsOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to apply this saved view.');
    } finally {
      setViewBusy('');
    }
  }

  async function deleteView(view: SavedView) {
    if (!selectedId || !window.confirm(`Delete “${view.name}”?`)) return;
    setViewBusy(view.id);
    try {
      await fetch(`/api/customer/workspaces/${encodeURIComponent(selectedId)}/saved-views/${encodeURIComponent(view.id)}`, { method: 'DELETE' });
      setSavedViews((rows) => rows.filter((row) => row.id !== view.id));
    } finally {
      setViewBusy('');
    }
  }

  function chooseRole(next: CommandRole) {
    setCommandRole(next);
    window.localStorage.setItem('ops:dashboard-command-role', next);
  }

  function toggleGroup(group: string) {
    setOpenGroups((current) => ({ ...current, [group]: !current[group] }));
  }

  if (!workspace || !report) {
    return (
      <main className="cc2-loading">
        <div><Database size={36} /><LoaderCircle className="cc2-spin" size={25} /></div>
        <span>OPS INTELLIGENCE</span><h1>{error || 'Building your command center.'}</h1><p>Loading tenant-isolated HubSpot analytics and operational reports.</p>
        {error ? <button onClick={() => router.push('/onboarding')}>Return to onboarding</button> : null}
      </main>
    );
  }

  const overview = report.overview;
  const comparisons = report.comparisons;
  const allKpis: Kpi[] = [
    { label: 'Portfolio contacts', value: overview.portfolioContacts, helper: `${integer(overview.missingOwnerContacts)} without owner`, icon: UsersRound, tone: 'green' },
    { label: 'New contacts', value: overview.newContacts, helper: `${report.filters.days}-day acquisition`, icon: TrendingUp, tone: 'blue', comparison: comparisons.newContacts },
    { label: 'Calls', value: overview.calls, helper: 'Completed in selected period', icon: Phone, tone: 'teal', comparison: comparisons.calls, drilldown: 'calls' },
    { label: 'Meetings', value: overview.meetings, helper: `${percentage(overview.meetingRate)} per call`, icon: CalendarDays, tone: 'amber', comparison: comparisons.meetings, drilldown: 'meetings' },
    { label: 'Meeting rate', value: overview.meetingRate, helper: 'Calls converted to meetings', icon: Target, tone: 'purple', percent: true },
    { label: 'Completed tasks', value: overview.completedTasks, helper: `${integer(overview.openTasks)} still open`, icon: CheckCircle2, tone: 'green', comparison: comparisons.completedTasks },
    { label: 'Open deals', value: overview.openDeals, helper: `${integer(overview.dealsAtRisk)} currently at risk`, icon: BriefcaseBusiness, tone: 'blue', drilldown: 'open-deals' },
    { label: 'Open pipeline', value: overview.openPipeline, helper: 'CRM currency', icon: CircleDollarSign, tone: 'teal', amount: true },
    { label: 'Won deals', value: overview.wonDeals, helper: 'Closed won in period', icon: Gauge, tone: 'green', comparison: comparisons.wonDeals, drilldown: 'won-deals' },
    { label: 'Won revenue', value: overview.wonRevenue, helper: 'Closed-won value', icon: TrendingUp, tone: 'green', comparison: comparisons.wonRevenue, amount: true },
    { label: 'Overdue tasks', value: overview.overdueTasks, helper: `${integer(overview.tasksDueToday)} due today`, icon: ListTodo, tone: 'red', drilldown: 'overdue-tasks' },
    { label: 'Deals at risk', value: overview.dealsAtRisk, helper: 'No next step or overdue close', icon: AlertTriangle, tone: 'amber', drilldown: 'no-next-activity-deals' }
  ];
  const labelsByRole: Record<CommandRole, string[]> = {
    executive: ['Open pipeline', 'Won revenue', 'Open deals', 'Deals at risk', 'Meetings', 'Meeting rate'],
    manager: ['Calls', 'Meetings', 'Meeting rate', 'Completed tasks', 'Open deals', 'Overdue tasks'],
    sdr: ['New contacts', 'Calls', 'Meetings', 'Meeting rate', 'Completed tasks', 'Overdue tasks'],
    revops: ['Portfolio contacts', 'New contacts', 'Completed tasks', 'Overdue tasks', 'Open deals', 'Deals at risk']
  };
  const kpis = labelsByRole[commandRole].map((label) => allKpis.find((item) => item.label === label)).filter((item): item is Kpi => Boolean(item));
  const attentionCards = [
    { key: 'untouched-contacts', label: 'Untouched contacts', value: report.attention.untouchedContacts, helper: 'No outreach after two days', icon: UsersRound },
    { key: 'stale-contacts', label: 'Stale contacts', value: report.attention.staleContacts, helper: 'No contact for 21+ days', icon: Activity },
    { key: 'missing-owner-contacts', label: 'Missing owner', value: report.attention.missingOwnerContacts, helper: 'Contacts awaiting assignment', icon: ShieldCheck },
    { key: 'overdue-tasks', label: 'Overdue tasks', value: report.attention.overdueTasks, helper: 'Open tasks past due', icon: ListTodo },
    { key: 'no-next-activity-deals', label: 'No next activity', value: report.attention.noNextActivityDeals, helper: 'Open deals with no planned step', icon: BriefcaseBusiness },
    { key: 'overdue-close-deals', label: 'Overdue close date', value: report.attention.overdueCloseDeals, helper: 'Open deals beyond close date', icon: CalendarDays }
  ];
  const executiveInsight = overview.dealsAtRisk > 0
    ? `${integer(overview.dealsAtRisk)} open deals need intervention while ${compact(overview.openPipeline)} remains exposed in pipeline.`
    : `${integer(overview.meetings)} meetings and ${integer(overview.wonDeals)} wins were recorded without current deal-risk alerts.`;
  const totalRecords = Number(selectedState?.freshness?.total_records ?? 0);
  const newestSync = selectedState?.freshness?.newest_record_sync ? new Date(String(selectedState.freshness.newest_record_sync)).toLocaleString() : 'Sync pending';

  return (
    <main className="cc2-shell" data-command-role={commandRole}>
      <aside className="cc2-sidebar">
        <div className="cc2-brand"><span>{workspace.name.slice(0, 1).toUpperCase()}</span><div><strong>{workspace.name}</strong><small>Revenue Intelligence</small></div></div>
        <label className="cc2-company"><span>Company</span><select value={selectedId} onChange={(event) => void changeWorkspace(event.target.value)}>{workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}</select></label>
        <nav aria-label="Command center navigation">
          <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveTab('overview')}><LayoutDashboard size={17} /><span>Overview</span><ChevronRight size={14} /></button>
          <NavigationGroup id="revenue" label="Revenue" icon={CircleDollarSign} open={openGroups.revenue} onToggle={toggleGroup}>
            <button className={activeTab === 'pipeline' ? 'active' : ''} onClick={() => setActiveTab('pipeline')}>Pipeline & revenue</button>
            <button className={activeTab === 'team' ? 'active' : ''} onClick={() => setActiveTab('team')}>Team performance</button>
          </NavigationGroup>
          <NavigationGroup id="acquisition" label="Acquisition" icon={Target} open={openGroups.acquisition} onToggle={toggleGroup}>
            <button className={activeTab === 'acquisition' ? 'active' : ''} onClick={() => setActiveTab('acquisition')}>Activity & sources</button>
          </NavigationGroup>
          <a href="/dashboard/retention-budget"><BriefcaseBusiness size={17} /><span>Retention</span><ChevronRight size={14} /></a>
          <NavigationGroup id="crm" label="CRM Data" icon={Database} open={openGroups.crm} onToggle={toggleGroup}>
            <button className={activeTab === 'quality' ? 'active' : ''} onClick={() => setActiveTab('quality')}>Data quality</button>
            <a href="/dashboard/all-objects">All CRM objects</a>
            <a href="/dashboard/objects/contacts">Contacts</a>
            <a href="/dashboard/objects/companies">Companies</a>
            <a href="/dashboard/objects/deals">Deals</a>
            <a href="/dashboard/objects/calls">Calls</a>
            <a href="/dashboard/objects/meetings">Meetings</a>
            <a href="/dashboard/objects/tasks">Tasks</a>
          </NavigationGroup>
          <NavigationGroup id="admin" label="Administration" icon={Settings2} open={openGroups.admin} onToggle={toggleGroup}>
            <a href="/settings/workspace">Workspace settings</a>
            <a href="/settings/mappings">Mappings</a>
            <a href="/settings/data-sla">Data SLA</a>
            <a href="/settings/reports">Scheduled reports</a>
            <a href="/settings/alerts">Operational alerts</a>
            <a href="/settings/billing">Billing & usage</a>
            <a href="/settings/security">Security</a>
            <a href="/settings/readiness">Production readiness</a>
          </NavigationGroup>
        </nav>
        <div className="cc2-sync"><Database size={16} /><div><strong>{integer(totalRecords)} HubSpot records</strong><span>{newestSync}</span></div></div>
      </aside>

      <div className="cc2-main">
        <header className="cc2-topbar">
          <div className="cc2-title"><strong>{role.label}</strong><span>{workspace.name} · {report.filters.from} → {report.filters.to}</span></div>
          <div className="cc2-role-switch" aria-label="Dashboard role">{(Object.keys(ROLE_META) as CommandRole[]).map((id) => { const Icon = ROLE_META[id].icon; return <button key={id} className={commandRole === id ? 'active' : ''} onClick={() => chooseRole(id)} title={ROLE_META[id].label}><Icon size={15} /><span>{ROLE_META[id].shortLabel}</span></button>; })}</div>
          <div className="cc2-actions">
            <span className="cc2-live"><i />Live HubSpot</span>
            <button className={viewsOpen ? 'active' : ''} onClick={() => setViewsOpen((value) => !value)}><Bookmark size={15} />Views</button>
            <button onClick={() => void exportCsv()} disabled={exporting}><Download size={15} />{exporting ? 'Exporting' : 'CSV'}</button>
            <button className={filtersOpen ? 'active' : ''} onClick={() => setFiltersOpen((value) => !value)}><Filter size={15} />Filters</button>
            <button className="primary" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? 'cc2-spin' : ''} size={15} />Refresh</button>
          </div>
        </header>

        <section className="cc2-content">
          {error ? <div className="cc2-error" role="alert"><AlertTriangle size={17} />{error}<button onClick={() => setError('')} aria-label="Dismiss"><X size={14} /></button></div> : null}
          {viewsOpen ? <section className="cc2-views"><header><div><span>SAVED VIEWS</span><h2>Open the exact report you need.</h2></div><button onClick={() => setViewsOpen(false)} aria-label="Close saved views"><X size={16} /></button></header><form onSubmit={(event) => { event.preventDefault(); void createView(); }}><input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="Save current report as…" maxLength={80} /><button type="submit" disabled={viewBusy === 'create'}><Bookmark size={14} />Save view</button></form><div>{savedViews.length ? savedViews.map((view) => <article key={view.id}><button onClick={() => void applyView(view)} disabled={Boolean(viewBusy)}><span><strong>{view.name}</strong><small>{DATE_PRESETS.find((item) => item.value === view.datePreset)?.label || 'Custom'} · {titleCase(view.section)}</small></span>{view.isDefault ? <b><Star size={11} fill="currentColor" />Default</b> : null}</button><button onClick={() => void deleteView(view)} aria-label={`Delete ${view.name}`}><Trash2 size={14} /></button></article>) : <p>No saved views yet.</p>}</div></section> : null}

          <section className="cc2-hero">
            <div><span>{role.shortLabel.toUpperCase()} WORKSPACE</span><h1>{activeTab === 'overview' ? 'Know what matters, then act.' : activeTab === 'pipeline' ? 'Protect pipeline and move revenue.' : activeTab === 'acquisition' ? 'Turn activity into qualified conversations.' : activeTab === 'team' ? 'Coach execution with clear evidence.' : 'Keep CRM data reliable and ready.'}</h1><p>{activeTab === 'overview' ? executiveInsight : role.description}</p></div>
            <article><ShieldCheck size={20} /><div><strong>{percentage(report.dataQuality.score)}</strong><span>CRM quality score</span></div></article>
          </section>

          {filtersOpen ? <section className="cc2-filterbar">
            <label><span>Date window</span><select value={datePreset} onChange={(event) => { const next = event.target.value as DatePreset; setDatePreset(next); if (next !== 'custom') setDraft((current) => ({ ...current, ...rangeForPreset(next) })); }}>{DATE_PRESETS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>From</span><input type="date" value={draft.from} disabled={datePreset !== 'custom'} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
            <label><span>To</span><input type="date" value={draft.to} disabled={datePreset !== 'custom'} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
            <label><span>Owner</span><select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}><option value="">All owners</option>{report.filterOptions.owners.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
            <label><span>Country</span><select value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}><option value="">All countries</option>{report.filterOptions.countries.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label>
            <label><span>Pipeline</span><select value={draft.pipelineId} onChange={(event) => setDraft({ ...draft, pipelineId: event.target.value, stageId: '' })}><option value="">All pipelines</option>{report.filterOptions.pipelines.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
            <label><span>Stage</span><select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}><option value="">All stages</option>{stages.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
            <label><span>Lead source</span><select value={draft.leadSource} onChange={(event) => setDraft({ ...draft, leadSource: event.target.value })}><option value="">All sources</option>{report.filterOptions.leadSources.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label>
            <div><button onClick={() => void resetFilters()}><RotateCcw size={14} />Reset</button><button className="primary" onClick={() => void applyFilters()} disabled={loading}><Search size={14} />Apply</button></div>
          </section> : null}

          <section className="cc2-kpi-grid">{kpis.map((item) => <KpiCard key={item.label} item={item} onOpen={loadDrilldown} />)}</section>

          {activeTab === 'overview' ? <>
            <section className="cc2-attention"><header><div><span>WHAT NEEDS ATTENTION</span><h2>Action queue</h2></div><b>{integer(Object.values(report.attention).reduce((sum, value) => sum + Number(value || 0), 0))} signals</b></header><div>{attentionCards.map(({ key, label, value, helper, icon: Icon }) => <button key={key} onClick={() => void loadDrilldown(key, label)}><span><Icon size={17} /></span><div><strong>{integer(value)}</strong><h3>{label}</h3><p>{helper}</p></div><ChevronRight size={15} /></button>)}</div></section>
            <section className="cc2-grid wide"><Panel title="Activity performance" description="Calls, meetings and tasks across the selected reporting period." action={<span className="cc2-chip">Compared with previous period</span>}><div className="cc2-chart large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.activityTrend} margin={{ top: 8, right: 10, left: -18, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4ebe8" /><XAxis dataKey="day" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 10, fill: '#768780' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#768780' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} /><Area type="monotone" dataKey="calls" stroke="#087a50" fill="rgba(8,122,80,.13)" strokeWidth={2.5} /><Area type="monotone" dataKey="meetings" stroke="#3a7de0" fill="transparent" strokeWidth={2} /><Area type="monotone" dataKey="tasks" stroke="#d98d25" fill="transparent" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></Panel><Panel title="Pipeline by stage" description="Open deal value across active pipeline stages." action={<span className="cc2-chip">{compact(overview.openPipeline)} exposed</span>}><div className="cc2-chart large"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage.slice(0, 10)} layout="vertical" margin={{ top: 0, right: 18, left: 8, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4ebe8" /><XAxis type="number" tickFormatter={(value) => compact(value)} tick={{ fontSize: 10, fill: '#768780' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="stageLabel" width={115} tick={{ fontSize: 10, fill: '#3f554d' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => compact(value)} /><Bar dataKey="amount" fill="#087a50" radius={[0, 7, 7, 0]} /></BarChart></ResponsiveContainer></div></Panel></section>
          </> : null}

          {activeTab === 'pipeline' ? <section className="cc2-grid"><Panel title="Pipeline by stage" description="Deal value and volume by current stage." action={<span className="cc2-chip">{integer(overview.openDeals)} open deals</span>}><div className="cc2-chart large"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage.slice(0, 14)} layout="vertical" margin={{ right: 18, left: 12 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4ebe8" /><XAxis type="number" tickFormatter={(value) => compact(value)} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="stageLabel" width={130} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => compact(value)} /><Bar dataKey="amount" fill="#087a50" radius={[0, 7, 7, 0]} /></BarChart></ResponsiveContainer></div></Panel><Panel title="Revenue risk queue" description="Deals that need a next action or corrected close date."><div className="cc2-risk-list">{attentionCards.slice(3).map(({ key, label, value, helper, icon: Icon }) => <button key={key} onClick={() => void loadDrilldown(key, label)}><Icon size={17} /><span><strong>{integer(value)}</strong><b>{label}</b><small>{helper}</small></span><ChevronRight size={15} /></button>)}</div></Panel></section> : null}

          {activeTab === 'acquisition' ? <><section className="cc2-grid"><Panel title="Lead source performance" description="Contacts, opportunities and wins by acquisition source."><div className="cc2-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.leadSourcePerformance.slice(0, 10)} margin={{ top: 8, right: 10, left: -14, bottom: 38 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4ebe8" /><XAxis dataKey="key" angle={-28} textAnchor="end" interval={0} tick={{ fontSize: 9, fill: '#667970' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#768780' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="contacts" fill="#087a50" radius={[5, 5, 0, 0]} /><Bar dataKey="opportunities" fill="#3a7de0" radius={[5, 5, 0, 0]} /><Bar dataKey="won" fill="#1aa6a0" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel><Panel title="Market distribution" description="Contact concentration across countries and commercial markets."><div className="cc2-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.countryDistribution.slice(0, 8)} dataKey="value" nameKey="key" innerRadius={65} outerRadius={102} paddingAngle={2}>{report.countryDistribution.slice(0, 8).map((row, index) => <Cell key={row.key} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip formatter={(value) => integer(value)} /><Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer></div></Panel></section><Panel title="Activity trend" description="Daily call, meeting and task execution."><div className="cc2-chart large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.activityTrend} margin={{ top: 8, right: 12, left: -18 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4ebe8" /><XAxis dataKey="day" tickFormatter={(value: string) => value.slice(5)} axisLine={false} tickLine={false} /><YAxis axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" /><Area type="monotone" dataKey="calls" stroke="#087a50" fill="rgba(8,122,80,.13)" strokeWidth={2.5} /><Area type="monotone" dataKey="meetings" stroke="#3a7de0" fill="transparent" strokeWidth={2} /><Area type="monotone" dataKey="tasks" stroke="#d98d25" fill="transparent" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></Panel></> : null}

          {activeTab === 'team' ? <section className="cc2-grid wide"><Panel title="Team performance" description="Owner-level activity, conversion, open pipeline and won revenue." action={<span className="cc2-chip">{report.ownerPerformance.length} owners</span>}><div className="cc2-owner-table"><div className="head"><span>Owner</span><span>Calls</span><span>Meetings</span><span>Rate</span><span>Open deals</span><span>Pipeline</span><span>Won</span></div>{report.ownerPerformance.map((row, index) => <article key={`${row.ownerId}-${index}`}><span><i>{row.ownerName.slice(0, 2).toUpperCase()}</i><div><strong>{row.ownerName}</strong><small>{row.email || row.ownerId}</small></div></span><b>{integer(row.calls)}</b><b>{integer(row.meetings)}</b><b>{percentage(row.meetingRate)}</b><b>{integer(row.openDeals)}</b><b>{compact(row.openPipeline)}</b><b>{compact(row.wonRevenue)}</b></article>)}</div></Panel><div className="cc2-stack"><Panel title="Call outcomes" description="Disposition mix for calls in this period."><OutcomeList rows={report.outcomes.calls} /></Panel><Panel title="Meeting outcomes" description="Completion and outcome mix for meetings."><OutcomeList rows={report.outcomes.meetings} /></Panel></div></section> : null}

          {activeTab === 'quality' ? <section className="cc2-grid"><Panel title="CRM data quality" description="Completeness across the fields needed for reliable reporting." action={<span className="cc2-chip">{percentage(report.dataQuality.score)}</span>}><div className="cc2-quality">{report.dataQuality.fields.map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.complete)} complete · {integer(row.missing)} missing</span><b>{percentage(row.percentage)}</b></div><i><b style={{ width: `${Math.max(0, Math.min(100, row.percentage))}%` }} /></i></article>)}</div></Panel><Panel title="Task execution status" description="Current task-status distribution for the reporting period."><OutcomeList rows={report.outcomes.tasks} /></Panel></section> : null}
        </section>
      </div>

      {drilldown ? <div className="cc2-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDrilldown(null)}><aside className="cc2-drawer ric-drawer"><header><div><span>{titleCase(drilldown.objectType)} report</span><h2>{drillTitle}</h2><p>Live HubSpot records behind the selected number.</p></div><button onClick={() => setDrilldown(null)} aria-label="Close report"><X size={18} /></button></header><div className="cc2-drawer-list">{drilldown.results.map((row) => { const label = recordLabel(row); const href = recordUrl(workspace.portal_id, drilldown.objectType, row.id); return <article key={row.id}><div><strong>{label.name}</strong><small>{label.detail}</small></div><span><b>{titleCase(row.properties.hs_lead_status || row.properties.hs_task_status || row.properties.hs_call_status || row.properties.hs_meeting_outcome || row.properties.dealstage || 'Unknown')}</b><small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleDateString()}` : 'Live CRM record'}</small></span>{href ? <a href={href} target="_blank" rel="noreferrer">Open in HubSpot<ExternalLink size={13} /></a> : null}</article>; })}{!drilldown.results.length ? <div className="cc2-empty">No records match this report.</div> : null}</div><footer><button onClick={() => void loadDrilldown(drillKey, drillTitle, Math.max(0, drilldown.offset - drilldown.limit))} disabled={loading || drilldown.offset === 0}><ChevronLeft size={14} />Previous</button><span>{drilldown.offset + 1}–{drilldown.offset + drilldown.results.length}</span><button onClick={() => void loadDrilldown(drillKey, drillTitle, drilldown.offset + drilldown.limit)} disabled={loading || !drilldown.hasMore}>Next<ChevronRight size={14} /></button></footer></aside></div> : null}
    </main>
  );
}
