'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Database,
  Filter,
  Gauge,
  Globe2,
  Layers3,
  ListTodo,
  Phone,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Star,
  Target,
  Trash2,
  TrendingUp,
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
import './revenue-command-center.css';

type Filters = {
  from: string;
  to: string;
  ownerId: string;
  country: string;
  pipelineId: string;
  stageId: string;
  leadSource: string;
};

type DatePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'previous_month'
  | 'this_quarter'
  | 'this_year'
  | 'custom';

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
  widgetConfiguration: Record<string, unknown> | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
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

type Kpi = {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: string;
  helper: string;
  comparison?: Comparison;
  amount?: boolean;
  percent?: boolean;
  drilldown?: string;
};

type NavigationItem = {
  id: string;
  label: string;
  icon: LucideIcon;
};

const NAVIGATION: NavigationItem[] = [
  { id: 'overview', label: 'Executive overview', icon: Gauge },
  { id: 'activity', label: 'Activity performance', icon: Activity },
  { id: 'pipeline', label: 'Pipeline & revenue', icon: BriefcaseBusiness },
  { id: 'sources', label: 'Sources & markets', icon: Globe2 },
  { id: 'team', label: 'Team performance', icon: UsersRound },
  { id: 'quality', label: 'Data quality', icon: ShieldCheck }
];

const PIE_COLORS = [
  '#5b67f1', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9',
  '#22c55e', '#f97316', '#64748b', '#ef4444', '#06b6d4', '#a855f7'
];

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeForPreset(preset: DatePreset, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start = new Date(end);
  let to = new Date(end);

  switch (preset) {
    case 'today':
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      to = new Date(start);
      break;
    case 'last_7_days':
      start.setDate(start.getDate() - 6);
      break;
    case 'this_month':
      start = new Date(end.getFullYear(), end.getMonth(), 1);
      break;
    case 'previous_month':
      start = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      to = new Date(end.getFullYear(), end.getMonth(), 0);
      break;
    case 'this_quarter':
      start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
      break;
    case 'this_year':
      start = new Date(end.getFullYear(), 0, 1);
      break;
    case 'last_30_days':
    case 'custom':
    default:
      start.setDate(start.getDate() - 29);
      break;
  }
  return { from: formatDateInput(start), to: formatDateInput(to) };
}

const DATE_PRESET_OPTIONS: Array<{ value: DatePreset; label: string }> = [
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

const DEFAULT_DATE_PRESET: DatePreset = 'last_30_days';
const DEFAULT_DATE_RANGE = rangeForPreset(DEFAULT_DATE_PRESET);

const DEFAULT_FILTERS: Filters = {
  from: DEFAULT_DATE_RANGE.from,
  to: DEFAULT_DATE_RANGE.to,
  ownerId: '',
  country: '',
  pipelineId: '',
  stageId: '',
  leadSource: ''
};

function compact(value: unknown) {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(value ?? 0));
}

function integer(value: unknown) {
  return new Intl.NumberFormat('en').format(Number(value ?? 0));
}

function percentage(value: unknown) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function titleCase(value: unknown) {
  return String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function queryString(filters: Filters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  return params.toString();
}

function filtersFromSavedView(view: SavedView): Filters {
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

function savedViewConfiguration(
  name: string,
  datePreset: DatePreset,
  filters: Filters,
  dashboardSection: string,
  widgetConfiguration: Record<string, unknown> | null = null
) {
  return {
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
    section: dashboardSection,
    widgetConfiguration
  };
}

function Delta({ comparison }: { comparison?: Comparison }) {
  if (!comparison) return <span className="ric-delta neutral">Snapshot</span>;
  if (comparison.deltaPercent === null) {
    return <span className="ric-delta up"><ArrowUpRight size={12} />New</span>;
  }
  const positive = comparison.deltaPercent >= 0;
  return (
    <span className={`ric-delta ${positive ? 'up' : 'down'}`}>
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(comparison.deltaPercent).toFixed(1)}%
    </span>
  );
}

function KpiCard({ item, onOpen }: { item: Kpi; onOpen: (key: string, title: string) => void }) {
  const Icon = item.icon;
  const formatted = item.percent
    ? percentage(item.value)
    : item.amount
      ? compact(item.value)
      : integer(item.value);
  const content = (
    <>
      <div className="ric-kpi-top"><span><Icon size={17} /></span><Delta comparison={item.comparison} /></div>
      <strong>{formatted}</strong>
      <h3>{item.label}</h3>
      <p>{item.helper}</p>
    </>
  );
  return item.drilldown ? (
    <button className={`ric-kpi ric-tone-${item.tone}`} onClick={() => onOpen(item.drilldown!, item.label)}>
      {content}
    </button>
  ) : (
    <article className={`ric-kpi ric-tone-${item.tone}`}>{content}</article>
  );
}

function Panel({
  title,
  description,
  action,
  children,
  id
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="ric-panel" id={id}>
      <header><div><h2>{title}</h2><p>{description}</p></div>{action}</header>
      <div className="ric-panel-body">{children}</div>
    </section>
  );
}

function TooltipCard({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ric-tooltip">
      <strong>{label}</strong>
      {payload.map((row: any) => (
        <span key={row.dataKey}>
          <i style={{ background: row.color }} />
          {titleCase(row.name || row.dataKey)}
          <b>{integer(row.value)}</b>
        </span>
      ))}
    </div>
  );
}

function OutcomeList({ rows }: { rows: Array<{ key: string; value: number }> }) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) return <div className="ric-empty">No records match the selected filters.</div>;
  return (
    <div className="ric-outcome-list">
      {rows.slice(0, 7).map((row) => (
        <article key={row.key}>
          <div><strong>{titleCase(row.key)}</strong><span>{integer(row.value)}</span></div>
          <i><b style={{ width: `${Math.max(3, row.value / maximum * 100)}%` }} /></i>
        </article>
      ))}
    </div>
  );
}

function RecordLabel({ row }: { row: DrilldownRow }) {
  const properties = row.properties || {};
  if (properties.firstname || properties.lastname) {
    return (
      <>
        <strong>{[properties.firstname, properties.lastname].filter(Boolean).join(' ')}</strong>
        <small>{properties.email || properties.company || `HubSpot ID ${row.id}`}</small>
      </>
    );
  }
  if (properties.dealname) {
    return (
      <>
        <strong>{properties.dealname}</strong>
        <small>{properties.amount ? `Amount ${properties.amount}` : `HubSpot ID ${row.id}`}</small>
      </>
    );
  }
  return (
    <>
      <strong>{properties.hs_task_subject || properties.hs_call_title || properties.hs_meeting_title || `Record ${row.id}`}</strong>
      <small>{properties.hs_task_status || properties.hs_call_status || properties.hs_meeting_outcome || 'CRM record'}</small>
    </>
  );
}

function DrilldownDrawer({
  drilldown,
  title,
  portalId,
  loading,
  onClose,
  onPage
}: {
  drilldown: Drilldown | null;
  title: string;
  portalId?: string | number | null;
  loading: boolean;
  onClose: () => void;
  onPage: (offset: number) => void;
}) {
  if (!drilldown) return null;
  return (
    <div className="ric-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="ric-drawer">
        <header>
          <div>
            <span>{titleCase(drilldown.objectType)} report</span>
            <h2>{title}</h2>
            <p>Live records behind the selected report, with the current filters applied.</p>
          </div>
          <button onClick={onClose} aria-label="Close report"><X size={18} /></button>
        </header>
        <div className="ric-drawer-table">
          <div className="ric-drawer-head"><span>Record</span><span>Owner / Status</span><span>Company / Pipeline</span><span>Last activity</span></div>
          {drilldown.results.map((row) => {
            const properties = row.properties || {};
            const contactUrl = drilldown.objectType === 'contacts' && portalId
              ? `https://app.hubspot.com/contacts/${portalId}/contact/${row.id}`
              : null;
            const dealUrl = drilldown.objectType === 'deals' && portalId
              ? `https://app.hubspot.com/contacts/${portalId}/deal/${row.id}`
              : null;
            const recordUrl = contactUrl || dealUrl;
            return (
              <article key={row.id}>
                <span className="ric-record-main">
                  {recordUrl ? <a href={recordUrl} target="_blank" rel="noreferrer"><RecordLabel row={row} /></a> : <RecordLabel row={row} />}
                </span>
                <span>
                  <strong>{properties.hubspot_owner_id || properties.hs_activity_assigned_to_user_id || 'Unassigned'}</strong>
                  <small>{titleCase(properties.hs_lead_status || properties.hs_task_status || properties.hs_call_status || properties.hs_meeting_outcome || properties.dealstage || 'Unknown')}</small>
                </span>
                <span>
                  <strong>{properties.company || properties.pipeline || '—'}</strong>
                  <small>{properties.country || properties.jobtitle || properties.hs_task_priority || '—'}</small>
                </span>
                <span>
                  <strong>{properties.notes_last_contacted || properties.hs_timestamp || properties.closedate || '—'}</strong>
                  <small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleDateString()}` : 'Live CRM record'}</small>
                </span>
              </article>
            );
          })}
          {drilldown.results.length === 0 ? <div className="ric-empty">No records match this report.</div> : null}
        </div>
        <footer>
          <button onClick={() => onPage(Math.max(0, drilldown.offset - drilldown.limit))} disabled={loading || drilldown.offset === 0}>
            <ChevronLeft size={15} />Previous
          </button>
          <span>{drilldown.offset + 1}–{drilldown.offset + drilldown.results.length}</span>
          <button onClick={() => onPage(drilldown.offset + drilldown.limit)} disabled={loading || !drilldown.hasMore}>
            Next<ChevronRight size={15} />
          </button>
        </footer>
      </aside>
    </div>
  );
}

export function RevenueCommandCenter() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState<RevenuePayload | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [datePreset, setDatePreset] = useState<DatePreset>(DEFAULT_DATE_PRESET);
  const [appliedDatePreset, setAppliedDatePreset] = useState<DatePreset>(DEFAULT_DATE_PRESET);
  const [filterOpen, setFilterOpen] = useState(true);
  const [message, setMessage] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillTitle, setDrillTitle] = useState('Report details');
  const [drillKey, setDrillKey] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [viewBusyId, setViewBusyId] = useState('');
  const [viewName, setViewName] = useState('');
  const [viewError, setViewError] = useState('');
  const [activeViewId, setActiveViewId] = useState('');
  const [editingViewId, setEditingViewId] = useState('');
  const [editingViewName, setEditingViewName] = useState('');
  const [dashboardSection, setDashboardSection] = useState('overview');
  const [isPending, startTransition] = useTransition();

  const selectedState = useMemo(
    () => workspaces.find((row) => row.workspace.id === selectedId) ?? null,
    [workspaces, selectedId]
  );
  const workspace = selectedState?.workspace;
  const report = payload?.report;
  const stages = useMemo(
    () => (report?.filterOptions.stages ?? []).filter((row) => !draft.pipelineId || row.pipelineId === draft.pipelineId),
    [report, draft.pipelineId]
  );

  function transition(task: () => Promise<void>) {
    startTransition(() => { void task(); });
  }

  async function readWorkspaces(): Promise<WorkspaceState[]> {
    const response = await fetch('/api/customer/workspaces', { cache: 'no-store' });
    if (response.status === 401) {
      router.replace('/onboarding');
      return [];
    }
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load company workspaces.');
    return (result.results ?? []).filter(
      (row: WorkspaceState) => row.workspace.hubspot_status === 'connected'
    ) as WorkspaceState[];
  }

  async function readReport(workspaceId: string, nextFilters: Filters): Promise<void> {
    const response = await fetch(`/api/dashboard/${workspaceId}/reports?${queryString(nextFilters)}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to build the reporting workspace.');
    setPayload(result as RevenuePayload);
  }

  async function readSavedViews(workspaceId: string): Promise<SavedView[]> {
    const response = await fetch(`/api/customer/workspaces/${workspaceId}/saved-views`, { cache: 'no-store' });
    const result = await response.json();
    if (response.status === 401) {
      router.replace('/onboarding');
      return [];
    }
    if (!response.ok) throw new Error(result.message || 'Unable to load saved report views.');
    return (result.results ?? []) as SavedView[];
  }

  async function savedViewRequest(path: string, init: RequestInit): Promise<SavedView | null> {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      cache: 'no-store'
    });
    if (response.status === 401) {
      router.replace('/onboarding');
      throw new Error('Your session expired. Sign in to continue.');
    }
    if (response.status === 204) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Unable to update the saved view.');
    return result as SavedView;
  }

  function mergeSavedView(nextView: SavedView) {
    setSavedViews((current) => [
      nextView,
      ...current
        .filter((view) => view.id !== nextView.id)
        .map((view) => nextView.isDefault ? { ...view, isDefault: false } : view)
    ]);
  }

  function navigateToSection(section: string, behavior: ScrollBehavior = 'smooth') {
    const safeSection = NAVIGATION.some((item) => item.id === section) ? section : 'overview';
    setDashboardSection(safeSection);
    window.setTimeout(() => {
      document.getElementById(safeSection)?.scrollIntoView({ behavior, block: 'start' });
    }, 0);
  }

  useEffect(() => {
    let active = true;
    transition(async () => {
      try {
        const rows = await readWorkspaces();
        if (!active) return;
        const workspaceId = rows[0]?.workspace.id;
        if (!workspaceId) {
          router.replace('/onboarding');
          return;
        }
        setWorkspaces(rows);
        setSelectedId(workspaceId);
        setViewsLoading(true);
        const views = await readSavedViews(workspaceId).catch((error) => {
          setViewError(error instanceof Error ? error.message : 'Unable to load saved report views.');
          return [];
        });
        if (!active) return;
        setSavedViews(views);
        const defaultView = views.find((view) => view.isDefault);
        const initialFilters = defaultView ? filtersFromSavedView(defaultView) : DEFAULT_FILTERS;
        const initialPreset = defaultView?.datePreset ?? DEFAULT_DATE_PRESET;
        setActiveViewId(defaultView?.id ?? '');
        setDashboardSection(defaultView?.section ?? 'overview');
        setDatePreset(initialPreset);
        setAppliedDatePreset(initialPreset);
        setFilters(initialFilters);
        setDraft(initialFilters);
        await readReport(workspaceId, initialFilters);
        if (defaultView) navigateToSection(defaultView.section, 'auto');
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open reports.');
      } finally {
        if (active) {
          setViewsLoading(false);
          setInitialized(true);
        }
      }
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectWorkspace(workspaceId: string) {
    setSelectedId(workspaceId);
    setPayload(null);
    setDrilldown(null);
    setMessage('');
    setViewError('');
    setActiveViewId('');
    setSavedViews([]);
    setViewsLoading(true);
    transition(async () => {
      try {
        const views = await readSavedViews(workspaceId).catch((error) => {
          setViewError(error instanceof Error ? error.message : 'Unable to load saved report views.');
          return [];
        });
        setSavedViews(views);
        const defaultView = views.find((view) => view.isDefault);
        const nextFilters = defaultView ? filtersFromSavedView(defaultView) : DEFAULT_FILTERS;
        setActiveViewId(defaultView?.id ?? '');
        setDashboardSection(defaultView?.section ?? 'overview');
        setDatePreset(defaultView?.datePreset ?? DEFAULT_DATE_PRESET);
        setAppliedDatePreset(defaultView?.datePreset ?? DEFAULT_DATE_PRESET);
        setFilters(nextFilters);
        setDraft(nextFilters);
        await readReport(workspaceId, nextFilters);
        if (defaultView) navigateToSection(defaultView.section, 'auto');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to load this workspace.');
      } finally {
        setViewsLoading(false);
      }
    });
  }

  function applyFilters() {
    if (!selectedId) return;
    const nextFilters = datePreset === 'custom'
      ? draft
      : { ...draft, ...rangeForPreset(datePreset) };
    if (!nextFilters.from || !nextFilters.to || nextFilters.from > nextFilters.to) {
      setMessage('Choose a valid reporting start and end date.');
      return;
    }
    setDraft(nextFilters);
    setFilters(nextFilters);
    setAppliedDatePreset(datePreset);
    setDrilldown(null);
    setMessage('');
    transition(async () => {
      try {
        await readReport(selectedId, nextFilters);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to apply reporting filters.');
      }
    });
  }

  function resetFilters() {
    setDraft(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setDatePreset(DEFAULT_DATE_PRESET);
    setAppliedDatePreset(DEFAULT_DATE_PRESET);
    setActiveViewId('');
    setDashboardSection('overview');
    setDrilldown(null);
    if (!selectedId) return;
    transition(async () => {
      try {
        await readReport(selectedId, DEFAULT_FILTERS);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to reset reporting filters.');
      }
    });
  }

  function refresh() {
    if (!selectedId) return;
    setMessage('');
    transition(async () => {
      try {
        const rows = await readWorkspaces();
        setWorkspaces(rows);
        await readReport(selectedId, filters);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to refresh reports.');
      }
    });
  }

  function changeDatePreset(nextPreset: DatePreset) {
    setDatePreset(nextPreset);
    if (nextPreset !== 'custom') setDraft((current) => ({ ...current, ...rangeForPreset(nextPreset) }));
  }

  async function createView() {
    const name = viewName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 80) {
      setViewError('Enter a view name between 1 and 80 characters.');
      return;
    }
    if (!selectedId) return;
    setViewBusyId('create');
    setViewError('');
    try {
      const created = await savedViewRequest(`/api/customer/workspaces/${selectedId}/saved-views`, {
        method: 'POST',
        body: JSON.stringify(savedViewConfiguration(name, appliedDatePreset, filters, dashboardSection))
      });
      if (created) {
        mergeSavedView(created);
        setActiveViewId(created.id);
        setViewName('');
      }
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to save this reporting view.');
    } finally {
      setViewBusyId('');
    }
  }

  async function updateActiveView() {
    const activeView = savedViews.find((view) => view.id === activeViewId);
    if (!activeView || !selectedId) return;
    setViewBusyId(activeView.id);
    setViewError('');
    try {
      const updated = await savedViewRequest(`/api/customer/workspaces/${selectedId}/saved-views/${activeView.id}`, {
        method: 'PATCH',
        body: JSON.stringify(savedViewConfiguration(
          activeView.name,
          appliedDatePreset,
          filters,
          dashboardSection,
          activeView.widgetConfiguration
        ))
      });
      if (updated) mergeSavedView(updated);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to update the saved view.');
    } finally {
      setViewBusyId('');
    }
  }

  async function applySavedView(view: SavedView) {
    if (!selectedId) return;
    const nextFilters = filtersFromSavedView(view);
    setViewBusyId(view.id);
    setViewError('');
    setMessage('');
    try {
      await readReport(selectedId, nextFilters);
      setFilters(nextFilters);
      setDraft(nextFilters);
      setDatePreset(view.datePreset);
      setAppliedDatePreset(view.datePreset);
      setActiveViewId(view.id);
      setViewsOpen(false);
      navigateToSection(view.section);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to apply the saved view.');
    } finally {
      setViewBusyId('');
    }
  }

  async function renameView(view: SavedView) {
    const name = editingViewName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 80 || !selectedId) {
      setViewError('Enter a view name between 1 and 80 characters.');
      return;
    }
    setViewBusyId(view.id);
    setViewError('');
    try {
      const updated = await savedViewRequest(`/api/customer/workspaces/${selectedId}/saved-views/${view.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name })
      });
      if (updated) mergeSavedView(updated);
      setEditingViewId('');
      setEditingViewName('');
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to rename the saved view.');
    } finally {
      setViewBusyId('');
    }
  }

  async function duplicateView(view: SavedView) {
    if (!selectedId) return;
    setViewBusyId(view.id);
    setViewError('');
    try {
      const duplicated = await savedViewRequest(
        `/api/customer/workspaces/${selectedId}/saved-views/${view.id}/duplicate`,
        { method: 'POST', body: '{}' }
      );
      if (duplicated) mergeSavedView(duplicated);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to duplicate the saved view.');
    } finally {
      setViewBusyId('');
    }
  }

  async function toggleDefaultView(view: SavedView) {
    if (!selectedId) return;
    setViewBusyId(view.id);
    setViewError('');
    try {
      const updated = await savedViewRequest(`/api/customer/workspaces/${selectedId}/saved-views/${view.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isDefault: !view.isDefault })
      });
      if (updated) mergeSavedView(updated);
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to change the default view.');
    } finally {
      setViewBusyId('');
    }
  }

  async function removeView(view: SavedView) {
    if (!selectedId || !window.confirm(`Delete “${view.name}”? This cannot be undone.`)) return;
    setViewBusyId(view.id);
    setViewError('');
    try {
      await savedViewRequest(`/api/customer/workspaces/${selectedId}/saved-views/${view.id}`, { method: 'DELETE' });
      setSavedViews((current) => current.filter((item) => item.id !== view.id));
      if (activeViewId === view.id) setActiveViewId('');
    } catch (error) {
      setViewError(error instanceof Error ? error.message : 'Unable to delete the saved view.');
    } finally {
      setViewBusyId('');
    }
  }

  function loadDrilldown(key: string, title: string, offset = 0) {
    if (!selectedId) return;
    setDrillKey(key);
    setDrillTitle(title);
    setMessage('');
    transition(async () => {
      try {
        const response = await fetch(
          `/api/dashboard/${selectedId}/reports/${encodeURIComponent(key)}?${queryString(filters, { limit: 50, offset })}`,
          { cache: 'no-store' }
        );
        const result = await response.json();
        if (!response.ok || !result.drilldown) throw new Error(result.message || 'Unable to load report details.');
        setDrilldown(result.drilldown as Drilldown);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to load report details.');
      }
    });
  }

  if (!initialized || !workspace || !report) {
    return (
      <main className="ric-loading">
        <div><Database size={34} /><RefreshCw className="ric-spin" size={24} /></div>
        <span>Building your command center</span>
        <h1>Loading every report that matters.</h1>
        <p>Verifying your customer session and compiling tenant-isolated HubSpot analytics.</p>
        {message ? <button onClick={() => router.push('/onboarding')}>Return to onboarding</button> : null}
      </main>
    );
  }

  const overview = report.overview;
  const comparisons = report.comparisons;
  const kpis: Kpi[] = [
    { label: 'Portfolio contacts', value: overview.portfolioContacts, icon: UsersRound, tone: 'indigo', helper: `${integer(overview.missingOwnerContacts)} without owner` },
    { label: 'New contacts', value: overview.newContacts, icon: TrendingUp, tone: 'cyan', helper: `${report.filters.days}-day acquisition`, comparison: comparisons.newContacts },
    { label: 'Calls', value: overview.calls, icon: Phone, tone: 'teal', helper: 'Completed in selected period', comparison: comparisons.calls, drilldown: 'calls' },
    { label: 'Meetings', value: overview.meetings, icon: CalendarDays, tone: 'amber', helper: `${percentage(overview.meetingRate)} per call`, comparison: comparisons.meetings, drilldown: 'meetings' },
    { label: 'Meeting rate', value: overview.meetingRate, icon: Target, tone: 'violet', helper: 'Calls converted to meetings', percent: true },
    { label: 'Completed tasks', value: overview.completedTasks, icon: CheckCircle2, tone: 'green', helper: `${integer(overview.openTasks)} still open`, comparison: comparisons.completedTasks },
    { label: 'Open deals', value: overview.openDeals, icon: BriefcaseBusiness, tone: 'indigo', helper: `${integer(overview.dealsAtRisk)} currently at risk`, drilldown: 'open-deals' },
    { label: 'Open pipeline', value: overview.openPipeline, icon: CircleDollarSign, tone: 'cyan', helper: 'CRM currency', amount: true },
    { label: 'Won deals', value: overview.wonDeals, icon: Gauge, tone: 'green', helper: 'Closed won in period', comparison: comparisons.wonDeals, drilldown: 'won-deals' },
    { label: 'Won revenue', value: overview.wonRevenue, icon: TrendingUp, tone: 'teal', helper: 'Closed-won value', comparison: comparisons.wonRevenue, amount: true },
    { label: 'Overdue tasks', value: overview.overdueTasks, icon: ListTodo, tone: 'red', helper: `${integer(overview.tasksDueToday)} due today`, drilldown: 'overdue-tasks' },
    { label: 'Deals at risk', value: overview.dealsAtRisk, icon: AlertTriangle, tone: 'amber', helper: 'No next step or overdue close', drilldown: 'no-next-activity-deals' }
  ];

  const attentionCards: Array<{
    key: string;
    label: string;
    value: number;
    helper: string;
    icon: LucideIcon;
  }> = [
    { key: 'untouched-contacts', label: 'Untouched contacts', value: report.attention.untouchedContacts, helper: 'No outreach after two days', icon: UsersRound },
    { key: 'stale-contacts', label: 'Stale contacts', value: report.attention.staleContacts, helper: 'No contact for 21+ days', icon: Activity },
    { key: 'missing-owner-contacts', label: 'Missing owner', value: report.attention.missingOwnerContacts, helper: 'Contacts awaiting assignment', icon: ShieldCheck },
    { key: 'overdue-tasks', label: 'Overdue tasks', value: report.attention.overdueTasks, helper: 'Open tasks past due', icon: ListTodo },
    { key: 'no-next-activity-deals', label: 'No next activity', value: report.attention.noNextActivityDeals, helper: 'Open deals with no planned step', icon: BriefcaseBusiness },
    { key: 'overdue-close-deals', label: 'Overdue close date', value: report.attention.overdueCloseDeals, helper: 'Open deals beyond close date', icon: CalendarDays }
  ];

  const executiveInsight = overview.dealsAtRisk > 0
    ? `${integer(overview.dealsAtRisk)} open deals need intervention while ${compact(overview.openPipeline)} remains exposed in pipeline.`
    : `${integer(overview.meetings)} meetings and ${integer(overview.wonDeals)} wins were recorded with no current deal-risk alerts.`;

  return (
    <main className="ric-shell">
      <aside className="ric-sidebar">
        <div className="ric-brand">
          <span>{workspace.name.slice(0, 1).toUpperCase()}</span>
          <div><strong>{workspace.name}</strong><small>Revenue Intelligence</small></div>
        </div>
        <div className="ric-nav-label">COMMAND CENTER</div>
        <nav>
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <button key={id} className={dashboardSection === id ? 'active' : ''} onClick={() => navigateToSection(id)}>
              <Icon size={16} /><span>{label}</span><ChevronRight size={14} />
            </button>
          ))}
        </nav>
        <div className="ric-nav-label">COMPANIES</div>
        <div className="ric-workspaces">
          {workspaces.map((row) => (
            <button
              key={row.workspace.id}
              className={row.workspace.id === selectedId ? 'active' : ''}
              onClick={() => selectWorkspace(row.workspace.id)}
            >
              <i>{row.workspace.name.slice(0, 2).toUpperCase()}</i>
              <span>{row.workspace.name}</span><b />
            </button>
          ))}
        </div>
        <div className="ric-sync">
          <Database size={16} />
          <div>
            <strong>Live HubSpot data</strong>
            <span>{selectedState?.freshness?.newest_record_sync ? new Date(String(selectedState.freshness.newest_record_sync)).toLocaleString() : 'Sync pending'}</span>
          </div>
        </div>
      </aside>

      <header className="ric-topbar">
        <div><strong>Revenue Command Center</strong><span>{report.filters.from} → {report.filters.to} · {report.filters.days} days</span></div>
        <div>
          <span className="ric-live"><i />LIVE · HUBSPOT</span>
          <button className={viewsOpen ? 'active' : ''} onClick={() => { setViewsOpen((value) => !value); setViewError(''); }}>
            <Bookmark size={16} />Views{activeViewId ? <i className="ric-view-dot" /> : null}
          </button>
          <button className={filterOpen ? 'active' : ''} onClick={() => setFilterOpen((value) => !value)}><Filter size={16} />Filters</button>
          <button className="primary" onClick={refresh} disabled={isPending}><RefreshCw size={16} className={isPending ? 'ric-spin' : ''} />{isPending ? 'Refreshing' : 'Refresh'}</button>
        </div>
      </header>

      <section className="ric-content">
        {viewsOpen ? (
          <section className="ric-views-panel" aria-label="Saved reporting views">
            <header>
              <div><span>SAVED REPORTING VIEWS</span><h2>Return to the exact report you need.</h2><p>Views are private to your account inside {workspace.name}.</p></div>
              {activeViewId ? (
                <button onClick={updateActiveView} disabled={Boolean(viewBusyId)}>
                  <Save size={15} />{viewBusyId === activeViewId ? 'Updating' : 'Update active view'}
                </button>
              ) : null}
            </header>
            <form onSubmit={(event) => { event.preventDefault(); void createView(); }}>
              <label htmlFor="saved-view-name">Save current report</label>
              <div>
                <input
                  id="saved-view-name"
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder="e.g. UAE pipeline review"
                  maxLength={80}
                  disabled={viewBusyId === 'create'}
                />
                <button type="submit" className="primary" disabled={viewBusyId === 'create'}>
                  <Bookmark size={15} />{viewBusyId === 'create' ? 'Saving' : 'Save view'}
                </button>
              </div>
            </form>
            {viewError ? <div className="ric-view-error" role="alert">{viewError}</div> : null}
            <div className="ric-view-list">
              {viewsLoading ? <div className="ric-view-state"><RefreshCw className="ric-spin" size={18} />Loading saved views…</div> : null}
              {!viewsLoading && savedViews.length === 0 ? (
                <div className="ric-view-state"><Bookmark size={19} /><strong>No saved views yet</strong><span>Choose filters, apply them, then save this report.</span></div>
              ) : null}
              {!viewsLoading ? savedViews.map((view) => (
                <article key={view.id} className={activeViewId === view.id ? 'active' : ''}>
                  {editingViewId === view.id ? (
                    <form onSubmit={(event) => { event.preventDefault(); void renameView(view); }} className="ric-view-rename">
                      <input value={editingViewName} onChange={(event) => setEditingViewName(event.target.value)} maxLength={80} autoFocus />
                      <button type="submit" disabled={viewBusyId === view.id}>Save</button>
                      <button type="button" onClick={() => { setEditingViewId(''); setEditingViewName(''); }}>Cancel</button>
                    </form>
                  ) : (
                    <button className="ric-view-main" onClick={() => void applySavedView(view)} disabled={Boolean(viewBusyId)}>
                      <span><strong>{view.name}</strong><small>{DATE_PRESET_OPTIONS.find((item) => item.value === view.datePreset)?.label ?? 'Custom range'} · {titleCase(view.section)}</small></span>
                      {view.isDefault ? <b><Star size={11} fill="currentColor" />Default</b> : null}
                    </button>
                  )}
                  {editingViewId !== view.id ? <div className="ric-view-actions">
                    <button onClick={() => void toggleDefaultView(view)} disabled={Boolean(viewBusyId)} title={view.isDefault ? 'Remove default' : 'Set as default'} aria-label={view.isDefault ? 'Remove default view' : 'Set as default view'}><Star size={14} fill={view.isDefault ? 'currentColor' : 'none'} /></button>
                    <button onClick={() => void duplicateView(view)} disabled={Boolean(viewBusyId)} title="Duplicate view" aria-label="Duplicate view"><Copy size={14} /></button>
                    <button onClick={() => { setEditingViewId(view.id); setEditingViewName(view.name); setViewError(''); }} disabled={Boolean(viewBusyId)} title="Rename view" aria-label="Rename view"><Pencil size={14} /></button>
                    <button onClick={() => void removeView(view)} disabled={Boolean(viewBusyId)} title="Delete view" aria-label="Delete view"><Trash2 size={14} /></button>
                  </div> : null}
                </article>
              )) : null}
            </div>
          </section>
        ) : null}

        <section className="ric-heading" id="overview">
          <div><span>EXECUTIVE INTELLIGENCE</span><h1>See the whole revenue operation.</h1><p>{executiveInsight}</p></div>
          <div className="ric-score"><ShieldCheck size={20} /><div><strong>{percentage(report.dataQuality.score)}</strong><span>CRM quality score</span></div></div>
        </section>

        {filterOpen ? (
          <section className="ric-filterbar">
            <label><span>Date window</span><select value={datePreset} onChange={(event) => changeDatePreset(event.target.value as DatePreset)}>{DATE_PRESET_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>From</span><input type="date" value={draft.from} disabled={datePreset !== 'custom'} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
            <label><span>To</span><input type="date" value={draft.to} disabled={datePreset !== 'custom'} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
            <label><span>Owner</span><select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}><option value="">All owners</option>{report.filterOptions.owners.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
            <label><span>Country</span><select value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}><option value="">All countries</option>{report.filterOptions.countries.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label>
            <label><span>Pipeline</span><select value={draft.pipelineId} onChange={(event) => setDraft({ ...draft, pipelineId: event.target.value, stageId: '' })}><option value="">All pipelines</option>{report.filterOptions.pipelines.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
            <label><span>Stage</span><select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}><option value="">All stages</option>{stages.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>
            <label><span>Lead source</span><select value={draft.leadSource} onChange={(event) => setDraft({ ...draft, leadSource: event.target.value })}><option value="">All sources</option>{report.filterOptions.leadSources.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label>
            <div className="ric-filter-actions"><button onClick={resetFilters}><RotateCcw size={15} />Reset</button><button className="primary" onClick={applyFilters} disabled={isPending}><Search size={15} />Apply filters</button></div>
          </section>
        ) : null}
        {message ? <div className="ric-message">{message}</div> : null}

        <section className="ric-kpi-grid">
          {kpis.map((item) => <KpiCard key={item.label} item={item} onOpen={loadDrilldown} />)}
        </section>

        <section className="ric-attention">
          <header><div><span>WHAT NEEDS ATTENTION NOW</span><h2>Action queue</h2></div><b>{integer(Object.values(report.attention).reduce((sum, value) => sum + Number(value || 0), 0))} signals</b></header>
          <div>
            {attentionCards.map(({ key, label, value, helper, icon: Icon }) => (
              <button key={key} onClick={() => loadDrilldown(key, label)}>
                <span><Icon size={18} /></span><div><strong>{integer(value)}</strong><h3>{label}</h3><p>{helper}</p></div><ChevronRight size={16} />
              </button>
            ))}
          </div>
        </section>

        <section className="ric-grid ric-grid-wide" id="activity">
          <Panel title="Activity performance" description="Calls, meetings and tasks across the selected reporting period." action={<span className="ric-chip">Compared with {report.comparisonPeriod.from} → {report.comparisonPeriod.to}</span>}>
            <div className="ric-chart large">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={report.activityTrend} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b67f1" stopOpacity={0.34} /><stop offset="100%" stopColor="#5b67f1" stopOpacity={0} /></linearGradient>
                    <linearGradient id="tasksFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.25} /><stop offset="100%" stopColor="#14b8a6" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" />
                  <XAxis dataKey="day" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<TooltipCard />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="calls" stroke="#5b67f1" fill="url(#callsFill)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="tasks" stroke="#14b8a6" fill="url(#tasksFill)" strokeWidth={2} />
                  <Area type="monotone" dataKey="meetings" stroke="#f59e0b" fill="transparent" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Pipeline by stage" description="Open deal volume and value across active stages." action={<span className="ric-chip">{compact(overview.openPipeline)} exposed</span>} id="pipeline">
            <div className="ric-chart large">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.pipelineByStage.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 18, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e8edf5" />
                  <XAxis type="number" tickFormatter={(value) => compact(value)} tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="stageLabel" width={112} tick={{ fontSize: 10, fill: '#536176' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => compact(value)} />
                  <Bar dataKey="amount" radius={[0, 7, 7, 0]} fill="#5b67f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </section>

        <section className="ric-grid" id="sources">
          <Panel title="Lead source performance" description="Contacts, opportunities and wins by acquisition source.">
            <div className="ric-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.leadSourcePerformance.slice(0, 8)} margin={{ top: 6, right: 8, left: -14, bottom: 36 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" />
                  <XAxis dataKey="key" angle={-28} textAnchor="end" interval={0} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<TooltipCard />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="contacts" fill="#5b67f1" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="opportunities" fill="#14b8a6" radius={[5, 5, 0, 0]} />
                  <Bar dataKey="won" fill="#22c55e" radius={[5, 5, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Market distribution" description="Contact concentration across countries and commercial markets.">
            <div className="ric-chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={report.countryDistribution} dataKey="value" nameKey="key" innerRadius={68} outerRadius={105} paddingAngle={2}>
                    {report.countryDistribution.map((row, index) => <Cell key={row.key} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => integer(value)} />
                  <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </section>

        <section className="ric-grid ric-grid-wide" id="team">
          <Panel title="Team performance" description="Owner-level activity, conversion, open pipeline and won revenue." action={<span className="ric-chip">{report.ownerPerformance.length} owners</span>}>
            <div className="ric-owner-table">
              <div className="ric-owner-head"><span>Owner</span><span>Calls</span><span>Meetings</span><span>Rate</span><span>Open deals</span><span>Pipeline</span><span>Won revenue</span></div>
              {report.ownerPerformance.map((row, index) => (
                <article key={`${row.ownerId}-${index}`}>
                  <span><i>{row.ownerName.slice(0, 2).toUpperCase()}</i><div><strong>{row.ownerName}</strong><small>{row.email || row.ownerId}</small></div></span>
                  <b>{integer(row.calls)}</b><b>{integer(row.meetings)}</b><b>{percentage(row.meetingRate)}</b><b>{integer(row.openDeals)}</b><b>{compact(row.openPipeline)}</b><b>{compact(row.wonRevenue)}</b>
                </article>
              ))}
              {report.ownerPerformance.length === 0 ? <div className="ric-empty">No owner activity matches the selected filters.</div> : null}
            </div>
          </Panel>
          <div className="ric-stack">
            <Panel title="Call outcomes" description="Disposition mix for calls in the selected period."><OutcomeList rows={report.outcomes.calls} /></Panel>
            <Panel title="Meeting outcomes" description="Completion and outcome mix for meetings."><OutcomeList rows={report.outcomes.meetings} /></Panel>
          </div>
        </section>

        <section className="ric-grid" id="quality">
          <Panel title="CRM data quality" description="Completeness across the fields needed for reliable reporting." action={<span className="ric-score-pill">{percentage(report.dataQuality.score)}</span>}>
            <div className="ric-quality-list">
              {report.dataQuality.fields.map((row) => (
                <article key={row.key}>
                  <div><strong>{titleCase(row.key)}</strong><span>{integer(row.complete)} complete · {integer(row.missing)} missing</span><b>{percentage(row.percentage)}</b></div>
                  <i><b style={{ width: `${Math.max(0, Math.min(100, row.percentage))}%` }} /></i>
                </article>
              ))}
            </div>
          </Panel>
          <Panel title="Task execution status" description="Current task-status distribution for the reporting period."><OutcomeList rows={report.outcomes.tasks} /></Panel>
        </section>

        <section className="ric-footprint">
          <div><Layers3 size={18} /><span>Active filters</span><strong>{[filters.ownerId, filters.country, filters.pipelineId, filters.stageId, filters.leadSource].filter(Boolean).length + 1}</strong></div>
          <div><BarChart3 size={18} /><span>Report modules</span><strong>14</strong></div>
          <div><Database size={18} /><span>Generated</span><strong>{new Date(report.generatedAt).toLocaleTimeString()}</strong></div>
          <div><Building2 size={18} /><span>Workspace</span><strong>{workspace.name}</strong></div>
        </section>
      </section>

      <DrilldownDrawer
        drilldown={drilldown}
        title={drillTitle || titleCase(drillKey)}
        portalId={workspace.portal_id}
        loading={isPending}
        onClose={() => setDrilldown(null)}
        onPage={(offset) => loadDrilldown(drillKey, drillTitle, offset)}
      />
    </main>
  );
}
