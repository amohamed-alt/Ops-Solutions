'use client';

import { useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
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
  CloudOff,
  Crown,
  Database,
  Download,
  Filter,
  Gauge,
  Globe2,
  Layers3,
  ListChecks,
  ListTodo,
  LoaderCircle,
  LogOut,
  Phone,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
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
import './enterprise-revenue-workspace.css';

type MembershipRole = 'owner' | 'admin' | 'viewer';
type CommandRole = 'executive' | 'manager' | 'sdr' | 'revops';
type WorkspaceMembership = { id: string; name: string; role: MembershipRole };
type WorkspaceRow = WorkspaceMembership & { state: WorkspaceState | null };
type Preferences = {
  workspaceId: string;
  name: string;
  currency: string;
  timezone: string;
  locale: string;
  appearance: 'system' | 'light' | 'dark';
  accentColor: string;
  logoUrl: string | null;
};
type Filters = {
  from: string;
  to: string;
  ownerId: string;
  country: string;
  pipelineId: string;
  stageId: string;
  leadSource: string;
};
type DatePreset = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'previous_month' | 'this_quarter' | 'this_year' | 'custom';
type Comparison = { current: number; previous: number; deltaPercent: number | null };
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
  pipelineByStage: Array<{ pipelineId: string; stageId: string; pipelineLabel: string; stageLabel: string; deals: number; amount: number }>;
  leadSourcePerformance: Array<{ key: string; contacts: number; contacted: number; opportunities: number; won: number; winRate: number }>;
  countryDistribution: Array<{ key: string; value: number }>;
  ownerPerformance: Array<{ ownerId: string; ownerName: string; email?: string | null; calls: number; meetings: number; tasks: number; openDeals: number; openPipeline: number; wonRevenue: number; meetingRate: number }>;
  outcomes: Record<'calls' | 'meetings' | 'tasks', Array<{ key: string; value: number }>>;
  dataQuality: { totalContacts: number; score: number; fields: Array<{ key: string; complete: number; missing: number; percentage: number }> };
  attention: Record<string, number>;
};
type Goals = {
  monthlyRevenueTarget: number;
  quarterlyRevenueTarget: number;
  annualRevenueTarget: number;
  monthlyCallTarget: number;
  monthlyMeetingTarget: number;
  pipelineCoverageTarget: number;
  defaultProbability: number;
  staleDealDays: number;
  highValueThreshold: number;
  ownerTargets: Record<string, { revenueTarget?: number; callTarget?: number; meetingTarget?: number }>;
};
type RiskDeal = {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  amount: number;
  probability: number;
  weightedAmount: number;
  closeDate: string | null;
  nextActivityDate: string | null;
  inactiveDays: number | null;
  daysToClose: number | null;
  score: number;
  band: 'critical' | 'high' | 'medium' | 'low';
  reasons: string[];
  action: { status: string; snoozedUntil: string | null; note: string | null };
};
type Insight = { severity: 'success' | 'info' | 'warning' | 'critical'; category: string; title: string; message: string; action: string };
type Intelligence = {
  generatedAt: string;
  filters: Filters & { days: number };
  scope: { ownerId?: string | null; enforced?: boolean; reason?: string | null };
  goals: Goals;
  forecast: {
    target: number;
    actual: number;
    remainingTarget: number;
    openPipeline: number;
    weightedPipeline: number;
    commitPipeline: number;
    bestCasePipeline: number;
    expectedLanding: number;
    commitLanding: number;
    bestCaseLanding: number;
    gap: number;
    coverage: number;
    coverageTarget: number;
    attainmentActual: number;
    attainmentExpected: number;
  };
  risk: {
    totalDeals: number;
    criticalDeals: number;
    highDeals: number;
    mediumDeals: number;
    lowDeals: number;
    criticalValue: number;
    highValue: number;
    totalValueAtRisk: number;
    topDeals: RiskDeal[];
  };
  execution: { calls: number; meetings: number; callTarget: number; meetingTarget: number; callAttainment: number; meetingAttainment: number; meetingRate: number };
  quality: { missingOwnerContacts: number };
  owners: Array<{ ownerId: string; ownerName: string; wonRevenue: number; calls: number; meetings: number; revenueTarget: number; callTarget: number; meetingTarget: number; revenueAttainment: number | null; callAttainment: number | null; meetingAttainment: number | null }>;
  insights: Insight[];
};
type SavedView = {
  id: string;
  name: string;
  datePreset: DatePreset;
  filters: Partial<Filters>;
  section: string;
  isDefault: boolean;
};
type DrilldownRow = { id: string; properties: Record<string, string | undefined>; syncedAt?: string | null };
type Drilldown = { key: string; objectType: string; limit: number; offset: number; hasMore: boolean; results: DrilldownRow[] };
type DataHealth = { status: string; severity: 'success' | 'info' | 'warning' | 'critical'; message: string; totalRecords: number; newestSync: string | null; activeRun: null | { mode?: string; status?: string } };
type RoleConfig = { label: string; kicker: string; description: string; icon: LucideIcon; sections: string[] };

const ROLE_CONFIG: Record<CommandRole, RoleConfig> = {
  executive: { label: 'Executive', kicker: 'Revenue & forecast', description: 'Revenue attainment, expected landing, pipeline coverage and commercial risk.', icon: Crown, sections: ['overview', 'forecast', 'risk', 'pipeline', 'team'] },
  manager: { label: 'Sales Manager', kicker: 'Team execution', description: 'Owner performance, activity conversion, pipeline movement and interventions.', icon: UsersRound, sections: ['overview', 'actions', 'activity', 'pipeline', 'team'] },
  sdr: { label: 'SDR Workspace', kicker: 'Daily execution', description: 'Priority outreach, meetings, overdue work and source performance.', icon: UserRoundSearch, sections: ['overview', 'actions', 'activity', 'sources'] },
  revops: { label: 'RevOps', kicker: 'Systems & quality', description: 'Synchronization health, CRM completeness, operational readiness and governance.', icon: Wrench, sections: ['overview', 'quality', 'activity', 'sources'] }
};

const ROLE_ORDER: CommandRole[] = ['executive', 'manager', 'sdr', 'revops'];
const DATE_OPTIONS: Array<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' }, { value: 'this_month', label: 'This month' }, { value: 'previous_month', label: 'Previous month' },
  { value: 'this_quarter', label: 'This quarter' }, { value: 'this_year', label: 'This year' }, { value: 'custom', label: 'Custom range' }
];
const PIE_COLORS = ['#5b67f1', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#22c55e', '#f97316', '#64748b', '#ef4444'];
const DEFAULT_PREFERENCES: Omit<Preferences, 'workspaceId' | 'name'> = { currency: 'USD', timezone: 'UTC', locale: 'en-US', appearance: 'system', accentColor: '#0f766e', logoUrl: null };

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
  if (preset === 'yesterday') { start.setDate(start.getDate() - 1); to = new Date(start); }
  else if (preset === 'last_7_days') start.setDate(start.getDate() - 6);
  else if (preset === 'this_month') start = new Date(end.getFullYear(), end.getMonth(), 1);
  else if (preset === 'previous_month') { start = new Date(end.getFullYear(), end.getMonth() - 1, 1); to = new Date(end.getFullYear(), end.getMonth(), 0); }
  else if (preset === 'this_quarter') start = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
  else if (preset === 'this_year') start = new Date(end.getFullYear(), 0, 1);
  else if (preset === 'last_30_days' || preset === 'custom') start.setDate(start.getDate() - 29);
  return { from: formatDateInput(start), to: formatDateInput(to) };
}

const DEFAULT_RANGE = rangeForPreset('last_30_days');
const DEFAULT_FILTERS: Filters = { ...DEFAULT_RANGE, ownerId: '', country: '', pipelineId: '', stageId: '', leadSource: '' };

function queryString(filters: Filters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) if (String(value ?? '').trim()) params.set(key, String(value));
  return params.toString();
}

function titleCase(value: unknown) {
  return String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function allowedRoles(role: MembershipRole): CommandRole[] {
  return role === 'viewer' ? ['sdr'] : ROLE_ORDER;
}

function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'OI';
}

function Panel({ title, description, action, children, id }: { title: string; description: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="erw-panel" id={id}><header><div><h2>{title}</h2><p>{description}</p></div>{action}</header><div className="erw-panel-body">{children}</div></section>;
}

function Delta({ comparison }: { comparison?: Comparison }) {
  if (!comparison) return <span className="erw-delta neutral">Live</span>;
  if (comparison.deltaPercent === null) return <span className="erw-delta up"><ArrowUpRight size={12} />New</span>;
  const positive = comparison.deltaPercent >= 0;
  return <span className={`erw-delta ${positive ? 'up' : 'down'}`}>{positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(comparison.deltaPercent).toFixed(1)}%</span>;
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <div className="erw-tooltip"><strong>{label}</strong>{payload.map((row: any) => <span key={row.dataKey}><i style={{ background: row.color }} />{titleCase(row.name || row.dataKey)}<b>{new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(row.value || 0))}</b></span>)}</div>;
}

function Empty({ children = 'No records match the selected filters.' }: { children?: ReactNode }) {
  return <div className="erw-empty"><Database size={24} /><span>{children}</span></div>;
}

export function EnterpriseRevenueWorkspace() {
  const router = useRouter();
  const [workspaceRows, setWorkspaceRows] = useState<WorkspaceRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [intelligence, setIntelligence] = useState<Intelligence | null>(null);
  const [health, setHealth] = useState<DataHealth | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [datePreset, setDatePreset] = useState<DatePreset>('last_30_days');
  const [commandRole, setCommandRole] = useState<CommandRole>('executive');
  const [filterOpen, setFilterOpen] = useState(true);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState('');
  const [activeViewId, setActiveViewId] = useState('');
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillTitle, setDrillTitle] = useState('Report details');
  const [drillKey, setDrillKey] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [signalBusy, setSignalBusy] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selected = useMemo(() => workspaceRows.find((row) => row.id === selectedId) ?? null, [workspaceRows, selectedId]);
  const workspace = selected?.state?.workspace;
  const memberRole = selected?.role ?? 'viewer';
  const roles = useMemo(() => allowedRoles(memberRole), [memberRole]);
  const role = ROLE_CONFIG[commandRole];
  const stages = useMemo(() => (report?.filterOptions.stages ?? []).filter((row) => !draft.pipelineId || row.pipelineId === draft.pipelineId), [report, draft.pipelineId]);
  const locale = preferences?.locale || 'en-US';
  const currency = preferences?.currency || 'USD';

  const integer = useCallback((value: unknown) => new Intl.NumberFormat(locale).format(Number(value ?? 0)), [locale]);
  const compact = useCallback((value: unknown) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0)), [locale]);
  const money = useCallback((value: unknown) => {
    try { return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0)); }
    catch { return `${currency} ${compact(value)}`; }
  }, [locale, currency, compact]);
  const percentage = useCallback((value: unknown) => `${Number(value ?? 0).toFixed(1)}%`, []);

  const applyPreferences = useCallback((next: Preferences) => {
    const root = document.documentElement;
    root.style.setProperty('--workspace-accent', next.accentColor || DEFAULT_PREFERENCES.accentColor);
    root.style.setProperty('--workspace-accent-soft', `${next.accentColor || DEFAULT_PREFERENCES.accentColor}1a`);
    root.dataset.workspaceAppearance = next.appearance || 'system';
    root.dataset.workspaceCurrency = next.currency || 'USD';
    root.lang = next.locale?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
    root.dir = next.locale?.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
  }, []);

  const fetchJson = useCallback(async <T,>(url: string, fallbackMessage: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, { cache: 'no-store', ...init });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || fallbackMessage);
    return payload as T;
  }, []);

  const loadWorkspaceData = useCallback(async (workspaceId: string, nextFilters: Filters, silent = false) => {
    if (!silent) setLoading(true);
    setMessage('');
    try {
      const query = queryString(nextFilters);
      const [nextPreferences, reportPayload, nextIntelligence, operationsPayload, viewsPayload] = await Promise.all([
        fetchJson<Preferences>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/preferences`, 'Unable to load workspace preferences.').catch(() => ({ workspaceId, name: workspaceRows.find((row) => row.id === workspaceId)?.name || 'Workspace', ...DEFAULT_PREFERENCES })),
        fetchJson<{ report: Report }>(`/api/dashboard/${encodeURIComponent(workspaceId)}/reports?${query}`, 'Unable to load revenue reports.'),
        fetchJson<Intelligence>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/intelligence?${query}`, 'Unable to load revenue intelligence.'),
        fetchJson<any>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/operations`, 'Unable to load data health.').catch(() => null),
        fetchJson<{ results: SavedView[] }>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views`, 'Unable to load saved views.').catch(() => ({ results: [] }))
      ]);
      setPreferences(nextPreferences);
      applyPreferences(nextPreferences);
      setReport(reportPayload.report);
      setIntelligence(nextIntelligence);
      setSavedViews(viewsPayload.results ?? []);
      if (operationsPayload) setHealth({
        status: operationsPayload.health?.status || 'unknown',
        severity: operationsPayload.health?.severity || 'warning',
        message: operationsPayload.health?.message || 'Data health is unavailable.',
        totalRecords: Number(operationsPayload.sync?.freshness?.total_records || 0),
        newestSync: operationsPayload.sync?.freshness?.newest_record_sync || null,
        activeRun: operationsPayload.sync?.activeRun || null
      });
      window.localStorage.setItem('ops:last-dashboard-workspace', workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to open this revenue workspace.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applyPreferences, fetchJson, workspaceRows]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchJson<{ workspaces: WorkspaceMembership[] }>('/api/customer/auth/session', 'Sign in to open the revenue workspace.'),
      fetchJson<{ results: WorkspaceState[] }>('/api/customer/workspaces', 'Unable to load connected workspaces.')
    ]).then(([session, detailed]) => {
      if (!active) return;
      const stateById = new Map((detailed.results ?? []).map((item) => [item.workspace.id, item]));
      const rows = (session.workspaces ?? []).map((membership) => ({ ...membership, state: stateById.get(membership.id) ?? null }));
      const connected = rows.filter((row) => row.state?.workspace.hubspot_status === 'connected');
      if (connected.length === 0) { router.replace('/onboarding'); return; }
      const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
      const initial = connected.find((row) => row.id === remembered) ?? connected[0];
      const rememberedRole = window.localStorage.getItem(`ops:dashboard-command-role:${initial.id}`) as CommandRole | null;
      const allowed = allowedRoles(initial.role);
      const initialRole = rememberedRole && allowed.includes(rememberedRole) ? rememberedRole : allowed[0];
      setWorkspaceRows(connected);
      setSelectedId(initial.id);
      setCommandRole(initialRole);
      void loadWorkspaceData(initial.id, DEFAULT_FILTERS);
    }).catch((error) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : 'Unable to initialize the dashboard.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [fetchJson, loadWorkspaceData, router]);

  useEffect(() => () => {
    const root = document.documentElement;
    root.style.removeProperty('--workspace-accent');
    root.style.removeProperty('--workspace-accent-soft');
    delete root.dataset.workspaceAppearance;
    delete root.dataset.workspaceCurrency;
    root.lang = 'en';
    root.dir = 'ltr';
  }, []);

  function selectWorkspace(workspaceId: string) {
    const next = workspaceRows.find((row) => row.id === workspaceId);
    if (!next) return;
    const allowed = allowedRoles(next.role);
    const remembered = window.localStorage.getItem(`ops:dashboard-command-role:${workspaceId}`) as CommandRole | null;
    setSelectedId(workspaceId);
    setCommandRole(remembered && allowed.includes(remembered) ? remembered : allowed[0]);
    setFilters(DEFAULT_FILTERS);
    setDraft(DEFAULT_FILTERS);
    setDatePreset('last_30_days');
    setActiveViewId('');
    setDrilldown(null);
    void loadWorkspaceData(workspaceId, DEFAULT_FILTERS);
  }

  function selectRole(nextRole: CommandRole) {
    if (!roles.includes(nextRole)) return;
    setCommandRole(nextRole);
    window.localStorage.setItem(`ops:dashboard-command-role:${selectedId}`, nextRole);
    window.requestAnimationFrame(() => document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function changeDatePreset(next: DatePreset) {
    setDatePreset(next);
    if (next !== 'custom') setDraft((current) => ({ ...current, ...rangeForPreset(next) }));
  }

  function applyFilters() {
    if (!selectedId) return;
    const next = datePreset === 'custom' ? draft : { ...draft, ...rangeForPreset(datePreset) };
    if (!next.from || !next.to || next.from > next.to) { setMessage('Choose a valid reporting start and end date.'); return; }
    setFilters(next);
    setDraft(next);
    setDrilldown(null);
    startTransition(() => { void loadWorkspaceData(selectedId, next, true); });
  }

  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setDraft(DEFAULT_FILTERS);
    setDatePreset('last_30_days');
    setActiveViewId('');
    if (selectedId) startTransition(() => { void loadWorkspaceData(selectedId, DEFAULT_FILTERS, true); });
  }

  function refresh() {
    if (selectedId) startTransition(() => { void loadWorkspaceData(selectedId, filters, true); });
  }

  async function createView() {
    const name = viewName.trim().replace(/\s+/g, ' ');
    if (!name || !selectedId) return;
    try {
      const created = await fetchJson<SavedView>(`/api/customer/workspaces/${encodeURIComponent(selectedId)}/saved-views`, 'Unable to save this view.', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, datePreset, filters, section: 'overview', widgetConfiguration: { commandRole } })
      });
      setSavedViews((current) => [created, ...current.filter((view) => view.id !== created.id)]);
      setActiveViewId(created.id);
      setViewName('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save this view.'); }
  }

  async function applyView(view: SavedView) {
    if (!selectedId) return;
    const range = view.datePreset === 'custom' && view.filters.from && view.filters.to ? { from: view.filters.from, to: view.filters.to } : rangeForPreset(view.datePreset);
    const next: Filters = { ...DEFAULT_FILTERS, ...view.filters, ...range } as Filters;
    setDatePreset(view.datePreset);
    setFilters(next);
    setDraft(next);
    setActiveViewId(view.id);
    setViewsOpen(false);
    startTransition(() => { void loadWorkspaceData(selectedId, next, true); });
  }

  async function removeView(view: SavedView) {
    if (!selectedId || !window.confirm(`Delete “${view.name}”?`)) return;
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(selectedId)}/saved-views/${encodeURIComponent(view.id)}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 204) throw new Error('Unable to delete the saved view.');
      setSavedViews((current) => current.filter((item) => item.id !== view.id));
      if (activeViewId === view.id) setActiveViewId('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete the saved view.'); }
  }

  async function exportCsv() {
    if (!selectedId || exporting) return;
    setExporting(true);
    try {
      const active = savedViews.find((view) => view.id === activeViewId);
      const params = new URLSearchParams(queryString(filters));
      if (active?.name) params.set('viewName', active.name);
      const response = await fetch(`/api/dashboard/${encodeURIComponent(selectedId)}/export?${params}`);
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.message || 'Unable to export this report.'); }
      const disposition = response.headers.get('content-disposition') || '';
      const fileName = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || 'revenue-report.csv';
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to export this report.'); }
    finally { setExporting(false); }
  }

  function loadDrilldown(key: string, title: string, offset = 0) {
    if (!selectedId) return;
    setDrillKey(key); setDrillTitle(title);
    startTransition(async () => {
      try {
        const payload = await fetchJson<{ drilldown: Drilldown }>(`/api/dashboard/${encodeURIComponent(selectedId)}/reports/${encodeURIComponent(key)}?${queryString(filters, { limit: 50, offset })}`, 'Unable to load report details.');
        setDrilldown(payload.drilldown);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load report details.'); }
    });
  }

  async function updateSignal(deal: RiskDeal, status: 'open' | 'reviewed' | 'snoozed') {
    if (!selectedId || signalBusy) return;
    setSignalBusy(deal.id);
    try {
      await fetchJson(`/api/customer/workspaces/${encodeURIComponent(selectedId)}/intelligence/signals/deal-risk/${encodeURIComponent(deal.id)}`, 'Unable to update this signal.', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status, snoozeDays: 7 })
      });
      await loadWorkspaceData(selectedId, filters, true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update this signal.'); }
    finally { setSignalBusy(''); }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try { await fetch('/api/customer/auth/logout', { method: 'POST' }); }
    finally { router.replace('/onboarding'); router.refresh(); }
  }

  if (loading && (!report || !intelligence)) {
    return <main className="erw-loading"><div><Database size={34} /><LoaderCircle size={25} /></div><span>OPS INTELLIGENCE</span><h1>Building the revenue operating system.</h1><p>Applying tenant scope, forecasting rules, risk scoring and live HubSpot reporting.</p>{message ? <button onClick={() => router.push('/onboarding')}>Return to onboarding</button> : null}</main>;
  }
  if (!selected || !workspace || !report || !intelligence) return <main className="erw-loading"><h1>Revenue workspace unavailable.</h1><p>{message || 'Connect a HubSpot workspace to continue.'}</p></main>;

  const overview = report.overview;
  const forecast = intelligence.forecast;
  const execution = intelligence.execution;
  const quality = report.dataQuality;
  const attentionCards = [
    { key: 'untouched-contacts', label: 'Untouched contacts', value: report.attention.untouchedContacts, helper: 'No outreach after two days', icon: UsersRound },
    { key: 'stale-contacts', label: 'Stale contacts', value: report.attention.staleContacts, helper: 'No contact for 21+ days', icon: Activity },
    { key: 'missing-owner-contacts', label: 'Missing owner', value: report.attention.missingOwnerContacts, helper: 'Awaiting assignment', icon: ShieldCheck },
    { key: 'overdue-tasks', label: 'Overdue tasks', value: report.attention.overdueTasks, helper: 'Open tasks past due', icon: ListTodo },
    { key: 'no-next-activity-deals', label: 'No next activity', value: report.attention.noNextActivityDeals, helper: 'Deals without planned steps', icon: BriefcaseBusiness },
    { key: 'overdue-close-deals', label: 'Overdue close date', value: report.attention.overdueCloseDeals, helper: 'Deals beyond close date', icon: CalendarDays }
  ];

  const roleKpis = commandRole === 'executive' ? [
    { label: 'Won revenue', value: money(forecast.actual), helper: `${percentage(forecast.attainmentActual)} of target`, icon: CircleDollarSign, tone: 'green', comparison: report.comparisons.wonRevenue, key: 'won-deals' },
    { label: 'Expected landing', value: money(forecast.expectedLanding), helper: `${percentage(forecast.attainmentExpected)} of target`, icon: Sparkles, tone: 'indigo' },
    { label: 'Weighted pipeline', value: money(forecast.weightedPipeline), helper: `${money(forecast.openPipeline)} total open`, icon: TrendingUp, tone: 'blue', key: 'open-deals' },
    { label: 'Pipeline coverage', value: `${Math.min(forecast.coverage, 999).toFixed(2)}x`, helper: `${forecast.coverageTarget.toFixed(1)}x target`, icon: Gauge, tone: forecast.coverage >= forecast.coverageTarget ? 'green' : 'amber' },
    { label: 'Value at risk', value: money(intelligence.risk.totalValueAtRisk), helper: `${integer(intelligence.risk.criticalDeals + intelligence.risk.highDeals)} high-risk deals`, icon: AlertTriangle, tone: 'red' },
    { label: 'Forecast gap', value: money(forecast.gap), helper: forecast.target > 0 ? `${money(forecast.target)} selected target` : 'Configure targets', icon: Target, tone: forecast.gap > 0 ? 'amber' : 'green' }
  ] : commandRole === 'manager' ? [
    { label: 'Calls', value: integer(overview.calls), helper: `${percentage(execution.callAttainment)} of target`, icon: Phone, tone: 'blue', comparison: report.comparisons.calls, key: 'calls' },
    { label: 'Meetings', value: integer(overview.meetings), helper: `${percentage(execution.meetingAttainment)} of target`, icon: CalendarDays, tone: 'amber', comparison: report.comparisons.meetings, key: 'meetings' },
    { label: 'Meeting rate', value: percentage(overview.meetingRate), helper: 'Calls converted to meetings', icon: Target, tone: 'violet' },
    { label: 'Open deals', value: integer(overview.openDeals), helper: `${integer(overview.dealsAtRisk)} currently at risk`, icon: BriefcaseBusiness, tone: 'indigo', key: 'open-deals' },
    { label: 'Open pipeline', value: money(overview.openPipeline), helper: `${Math.min(forecast.coverage, 999).toFixed(2)}x coverage`, icon: CircleDollarSign, tone: 'green' },
    { label: 'Overdue tasks', value: integer(overview.overdueTasks), helper: `${integer(overview.tasksDueToday)} due today`, icon: ListTodo, tone: 'red', key: 'overdue-tasks' }
  ] : commandRole === 'sdr' ? [
    { label: 'New contacts', value: integer(overview.newContacts), helper: `${report.filters.days}-day acquisition`, icon: UsersRound, tone: 'indigo', comparison: report.comparisons.newContacts },
    { label: 'Calls', value: integer(overview.calls), helper: `${percentage(execution.callAttainment)} of target`, icon: Phone, tone: 'blue', comparison: report.comparisons.calls, key: 'calls' },
    { label: 'Meetings', value: integer(overview.meetings), helper: `${percentage(execution.meetingAttainment)} of target`, icon: CalendarDays, tone: 'amber', comparison: report.comparisons.meetings, key: 'meetings' },
    { label: 'Meeting rate', value: percentage(overview.meetingRate), helper: 'Calls converted to meetings', icon: Target, tone: 'violet' },
    { label: 'Completed tasks', value: integer(overview.completedTasks), helper: `${integer(overview.openTasks)} still open`, icon: CheckCircle2, tone: 'green', comparison: report.comparisons.completedTasks },
    { label: 'Overdue tasks', value: integer(overview.overdueTasks), helper: `${integer(overview.tasksDueToday)} due today`, icon: ListTodo, tone: 'red', key: 'overdue-tasks' }
  ] : [
    { label: 'Portfolio contacts', value: integer(overview.portfolioContacts), helper: `${integer(overview.missingOwnerContacts)} without owner`, icon: UsersRound, tone: 'indigo' },
    { label: 'CRM quality', value: percentage(quality.score), helper: `${integer(quality.totalContacts)} contacts assessed`, icon: ShieldCheck, tone: quality.score >= 85 ? 'green' : 'amber' },
    { label: 'Synced records', value: integer(health?.totalRecords || selected.state?.freshness?.total_records || 0), helper: health?.status || 'Live data health', icon: Database, tone: 'blue' },
    { label: 'Missing owner', value: integer(report.attention.missingOwnerContacts), helper: 'Contacts awaiting assignment', icon: UserRoundSearch, tone: 'red', key: 'missing-owner-contacts' },
    { label: 'Stale contacts', value: integer(report.attention.staleContacts), helper: 'No contact for 21+ days', icon: Activity, tone: 'amber', key: 'stale-contacts' },
    { label: 'Open tasks', value: integer(overview.openTasks), helper: `${integer(overview.overdueTasks)} overdue`, icon: ListChecks, tone: 'violet' }
  ];

  return (
    <main className="erw-shell" data-role={commandRole}>
      <aside className="erw-sidebar">
        <div className="erw-brand"><span>{preferences?.logoUrl ? <img src={preferences.logoUrl} alt="" /> : initials(preferences?.name || workspace.name)}</span><div><strong>{preferences?.name || workspace.name}</strong><small>Revenue operating system</small></div></div>
        <div className="erw-nav-label">{role.label.toUpperCase()} WORKSPACE</div>
        <nav>{role.sections.map((section) => {
          const meta: Record<string, { label: string; icon: LucideIcon }> = {
            overview: { label: 'Command overview', icon: Gauge }, forecast: { label: 'Forecast & targets', icon: Target }, risk: { label: 'Risk register', icon: AlertTriangle }, actions: { label: 'Action queue', icon: ListChecks }, activity: { label: 'Activity performance', icon: Activity }, pipeline: { label: 'Pipeline & revenue', icon: BriefcaseBusiness }, sources: { label: 'Sources & markets', icon: Globe2 }, team: { label: 'Team performance', icon: UsersRound }, quality: { label: 'Data quality', icon: ShieldCheck }
          };
          const item = meta[section]; const Icon = item.icon;
          return <button key={section} onClick={() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon size={17} /><span>{item.label}</span><ChevronRight size={14} /></button>;
        })}</nav>
        <div className="erw-nav-label">COMPANIES</div>
        <div className="erw-workspaces">{workspaceRows.map((row) => <button key={row.id} className={row.id === selectedId ? 'active' : ''} onClick={() => selectWorkspace(row.id)}><i>{initials(row.name)}</i><span><strong>{row.name}</strong><small>{row.role}</small></span><b /></button>)}</div>
        <div className="erw-sidebar-health"><Database size={17} /><div><strong>{health?.activeRun ? 'CRM sync running' : 'Live HubSpot data'}</strong><span>{health?.newestSync ? new Date(health.newestSync).toLocaleString(locale) : 'Sync pending'}</span></div></div>
      </aside>

      <header className="erw-topbar">
        <div><strong>Revenue Command Center</strong><span>{report.filters.from} → {report.filters.to} · {report.filters.days} days</span></div>
        <div><span className="erw-live"><i />LIVE · HUBSPOT</span><button className={viewsOpen ? 'active' : ''} onClick={() => setViewsOpen((value) => !value)}><Bookmark size={16} />Views</button><button onClick={() => void exportCsv()} disabled={exporting}><Download size={16} />{exporting ? 'Exporting' : 'CSV'}</button><button className={filterOpen ? 'active' : ''} onClick={() => setFilterOpen((value) => !value)}><Filter size={16} />Filters</button><button className="primary" onClick={refresh} disabled={isPending}><RefreshCw size={16} className={isPending ? 'erw-spin' : ''} />Refresh</button></div>
      </header>

      <section className="erw-content">
        <section className="erw-workspace-bar">
          <div><span>{role.icon({ size: 19 } as any)}</span><div><small>ROLE-BASED COMMAND CENTER · {memberRole.toUpperCase()} ACCESS</small><strong>{role.label}</strong><p>{role.description}</p></div></div>
          <div className="erw-role-tabs" role="tablist">{roles.map((item) => { const Icon = ROLE_CONFIG[item].icon; return <button key={item} className={commandRole === item ? 'active' : ''} onClick={() => selectRole(item)} role="tab" aria-selected={commandRole === item}><Icon size={17} /><span><strong>{ROLE_CONFIG[item].label}</strong><small>{ROLE_CONFIG[item].kicker}</small></span></button>; })}</div>
          <div className="erw-workspace-actions"><a href={`/settings/goals?workspaceId=${encodeURIComponent(selectedId)}`}><Target size={16} />Targets</a><a href={`/settings/workspace?workspaceId=${encodeURIComponent(selectedId)}`}><Settings2 size={16} />Manage</a><button onClick={() => void signOut()} disabled={signingOut}><LogOut size={16} />{signingOut ? 'Signing out' : 'Sign out'}</button></div>
        </section>

        {health ? <section className={`erw-health ${health.severity}`}><span>{health.severity === 'success' ? <CheckCircle2 /> : health.severity === 'critical' ? <CloudOff /> : <AlertTriangle />}</span><div><small>LIVE DATA HEALTH</small><strong>{health.status}</strong><p>{health.message}</p></div><div><b>{integer(health.totalRecords)} records</b><small>{health.newestSync ? new Date(health.newestSync).toLocaleString(locale, { timeZone: preferences?.timezone }) : 'No synchronized data yet'}</small></div></section> : null}
        {message ? <div className="erw-message" role="alert">{message}</div> : null}

        {viewsOpen ? <section className="erw-views"><header><div><small>SAVED REPORTING VIEWS</small><h2>Return to the exact report you need.</h2></div><button onClick={() => setViewsOpen(false)}><X size={16} /></button></header><form onSubmit={(event) => { event.preventDefault(); void createView(); }}><input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="e.g. UAE weekly pipeline" maxLength={100} /><button className="primary" type="submit"><Save size={15} />Save current view</button></form><div>{savedViews.length === 0 ? <Empty>No saved views yet.</Empty> : savedViews.map((view) => <article key={view.id} className={view.id === activeViewId ? 'active' : ''}><button onClick={() => void applyView(view)}><strong>{view.name}</strong><small>{DATE_OPTIONS.find((item) => item.value === view.datePreset)?.label || view.datePreset}</small></button><button className="danger" onClick={() => void removeView(view)}><X size={14} /></button></article>)}</div></section> : null}

        <section className="erw-hero" id="overview">
          <div><span>{commandRole === 'executive' ? 'EXECUTIVE REVENUE INTELLIGENCE' : commandRole === 'manager' ? 'SALES MANAGEMENT CONTROL ROOM' : commandRole === 'sdr' ? 'SDR DAILY EXECUTION WORKSPACE' : 'REVENUE OPERATIONS & DATA CONTROL'}</span><h1>{commandRole === 'executive' ? 'Revenue, forecast and risk — in one clear view.' : commandRole === 'manager' ? 'Know who is performing, what is blocked and where to act.' : commandRole === 'sdr' ? 'Turn today’s priority leads into completed conversations.' : 'Keep the CRM reliable, measurable and ready for scale.'}</h1><p>{intelligence.insights[0]?.message || `${integer(overview.openDeals)} open deals and ${money(overview.openPipeline)} in pipeline are currently visible.`}</p></div>
          <div className="erw-hero-score"><ShieldCheck size={22} /><div><strong>{percentage(quality.score)}</strong><span>CRM quality score</span></div><i><b style={{ width: `${Math.max(0, Math.min(100, quality.score))}%` }} /></i></div>
        </section>

        {filterOpen ? <section className="erw-filters"><label><span>Date window</span><select value={datePreset} onChange={(event) => changeDatePreset(event.target.value as DatePreset)}>{DATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label><span>From</span><input type="date" value={draft.from} disabled={datePreset !== 'custom'} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label><span>To</span><input type="date" value={draft.to} disabled={datePreset !== 'custom'} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label><label><span>Owner</span><select value={draft.ownerId} disabled={memberRole === 'viewer'} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}><option value="">All owners</option>{report.filterOptions.owners.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label><span>Country</span><select value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}><option value="">All countries</option>{report.filterOptions.countries.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label><label><span>Pipeline</span><select value={draft.pipelineId} onChange={(event) => setDraft({ ...draft, pipelineId: event.target.value, stageId: '' })}><option value="">All pipelines</option>{report.filterOptions.pipelines.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label><span>Stage</span><select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}><option value="">All stages</option>{stages.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label><span>Lead source</span><select value={draft.leadSource} onChange={(event) => setDraft({ ...draft, leadSource: event.target.value })}><option value="">All sources</option>{report.filterOptions.leadSources.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label><div><button onClick={resetFilters}><RotateCcw size={15} />Reset</button><button className="primary" onClick={applyFilters} disabled={isPending}><Search size={15} />Apply filters</button></div></section> : null}

        <section className="erw-kpis">{roleKpis.map((item) => { const Icon = item.icon; const card = <><div><span><Icon size={18} /></span><Delta comparison={item.comparison} /></div><strong>{item.value}</strong><h3>{item.label}</h3><p>{item.helper}</p></>; return item.key ? <button key={item.label} className={`tone-${item.tone}`} onClick={() => loadDrilldown(item.key!, item.label)}>{card}</button> : <article key={item.label} className={`tone-${item.tone}`}>{card}</article>; })}</section>

        {intelligence.insights.length > 0 ? <section className="erw-insights"><header><div><span><Sparkles size={17} /></span><div><small>EXECUTIVE BRIEF</small><h2>What changed and what needs attention</h2></div></header><div>{intelligence.insights.map((insight, index) => <article key={`${insight.category}-${index}`} className={insight.severity}><span>{insight.severity === 'success' ? <CheckCircle2 /> : insight.severity === 'critical' ? <AlertTriangle /> : insight.severity === 'warning' ? <Gauge /> : <Sparkles />}</span><div><small>{insight.category}</small><h3>{insight.title}</h3><p>{insight.message}</p><b>{insight.action}</b></div></article>)}</div></section> : null}

        {(role.sections.includes('actions') || commandRole === 'sdr') ? <section className="erw-actions" id="actions"><header><div><small>WHAT NEEDS ATTENTION NOW</small><h2>Action queue</h2></div><b>{integer(attentionCards.reduce((sum, item) => sum + Number(item.value || 0), 0))} signals</b></header><div>{attentionCards.map(({ key, label, value, helper, icon: Icon }) => <button key={key} onClick={() => loadDrilldown(key, label)}><span><Icon size={19} /></span><div><strong>{integer(value)}</strong><h3>{label}</h3><p>{helper}</p></div><ChevronRight size={16} /></button>)}</div></section> : null}

        {role.sections.includes('forecast') ? <section className="erw-grid wide" id="forecast"><Panel title="Forecast bridge" description="Actual revenue, commit, best case, expected landing and selected-period target." action={<a className="erw-chip" href={`/settings/goals?workspaceId=${encodeURIComponent(selectedId)}`}>Edit targets</a>}><div className="erw-forecast"><div className="erw-forecast-track"><i style={{ width: `${Math.min(100, forecast.attainmentActual)}%` }} /><b style={{ left: `${Math.min(100, forecast.attainmentExpected)}%` }} /></div><div className="erw-forecast-target"><span>Actual<strong>{money(forecast.actual)}</strong></span><span>Commit<strong>{money(forecast.commitLanding)}</strong></span><span>Expected<strong>{money(forecast.expectedLanding)}</strong></span><span>Best case<strong>{money(forecast.bestCaseLanding)}</strong></span><span>Target<strong>{money(forecast.target)}</strong></span></div><div className="erw-forecast-cards"><article><span>Weighted pipeline</span><strong>{money(forecast.weightedPipeline)}</strong></article><article><span>Remaining target</span><strong>{money(forecast.remainingTarget)}</strong></article><article><span>Coverage</span><strong>{Math.min(forecast.coverage, 999).toFixed(2)}x</strong></article><article><span>Expected attainment</span><strong>{percentage(forecast.attainmentExpected)}</strong></article></div></div></Panel><Panel title="Pipeline by stage" description="Open deal volume and value across active stages." action={<span className="erw-chip">{money(overview.openPipeline)} exposed</span>}><div className="erw-chart large"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 18, left: 10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e8edf5" /><XAxis type="number" tickFormatter={(value) => compact(value)} tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="stageLabel" width={120} tick={{ fontSize: 10, fill: '#536176' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => money(value)} /><Bar dataKey="amount" radius={[0, 7, 7, 0]} fill="var(--workspace-accent)" /></BarChart></ResponsiveContainer></div></Panel></section> : null}

        {role.sections.includes('risk') ? <section id="risk"><Panel title="Deal risk register" description="Scored using close-date exposure, inactivity, next steps, probability and deal value." action={<span className="erw-chip danger">{money(intelligence.risk.totalValueAtRisk)} at risk</span>}><div className="erw-risk-summary"><article><strong>{integer(intelligence.risk.criticalDeals)}</strong><span>Critical deals</span><b>{money(intelligence.risk.criticalValue)}</b></article><article><strong>{integer(intelligence.risk.highDeals)}</strong><span>High-risk deals</span><b>{money(intelligence.risk.highValue)}</b></article><article><strong>{integer(intelligence.risk.mediumDeals)}</strong><span>Medium risk</span><b>Review queue</b></article><article><strong>{integer(intelligence.risk.lowDeals)}</strong><span>Low risk</span><b>Healthy</b></article></div><div className="erw-risk-list">{intelligence.risk.topDeals.length === 0 ? <Empty>No material deal risks are visible.</Empty> : intelligence.risk.topDeals.map((deal) => <article key={deal.id}><div className={`erw-risk-score ${deal.band}`}><strong>{deal.score}</strong><span>{deal.band}</span></div><div className="erw-risk-main"><a href={workspace.portal_id ? `https://app.hubspot.com/contacts/${workspace.portal_id}/deal/${deal.id}` : '#'} target="_blank" rel="noreferrer"><strong>{deal.name}</strong></a><span>{deal.ownerName} · {money(deal.amount)} · {deal.probability.toFixed(0)}%</span><p>{deal.reasons.slice(0, 3).join(' · ')}</p></div><div className="erw-risk-actions"><button onClick={() => void updateSignal(deal, 'reviewed')} disabled={signalBusy === deal.id}><CheckCircle2 size={15} />Reviewed</button><button onClick={() => void updateSignal(deal, 'snoozed')} disabled={signalBusy === deal.id}><CalendarDays size={15} />Snooze 7d</button></div></article>)}</div></Panel></section> : null}

        {role.sections.includes('activity') ? <section className="erw-grid wide" id="activity"><Panel title="Activity performance" description="Calls, meetings and tasks across the selected reporting period." action={<span className="erw-chip">Compared with {report.comparisonPeriod.from} → {report.comparisonPeriod.to}</span>}><div className="erw-chart large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.activityTrend} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}><defs><linearGradient id="erwCalls" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--workspace-accent)" stopOpacity={0.34} /><stop offset="100%" stopColor="var(--workspace-accent)" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" /><XAxis dataKey="day" tickFormatter={(value: string) => value.slice(5)} tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /><Area type="monotone" dataKey="calls" stroke="var(--workspace-accent)" fill="url(#erwCalls)" strokeWidth={2.5} /><Area type="monotone" dataKey="tasks" stroke="#14b8a6" fill="transparent" strokeWidth={2} /><Area type="monotone" dataKey="meetings" stroke="#f59e0b" fill="transparent" strokeWidth={2.5} /></AreaChart></ResponsiveContainer></div></Panel><Panel title="Execution against target" description="Selected-period call and meeting targets from workspace settings."><div className="erw-target-list"><article><div><span>Calls</span><b>{integer(execution.calls)} / {compact(execution.callTarget)}</b><strong>{percentage(execution.callAttainment)}</strong></div><i><b style={{ width: `${Math.min(100, execution.callAttainment)}%` }} /></i></article><article><div><span>Meetings</span><b>{integer(execution.meetings)} / {compact(execution.meetingTarget)}</b><strong>{percentage(execution.meetingAttainment)}</strong></div><i><b style={{ width: `${Math.min(100, execution.meetingAttainment)}%` }} /></i></article><article><div><span>Call → meeting conversion</span><b>{integer(execution.meetings)} meetings</b><strong>{percentage(execution.meetingRate)}</strong></div><i><b style={{ width: `${Math.min(100, execution.meetingRate)}%` }} /></i></article></div></Panel></section> : null}

        {role.sections.includes('pipeline') && !role.sections.includes('forecast') ? <section className="erw-grid" id="pipeline"><Panel title="Pipeline by stage" description="Open deal value across active stages."><div className="erw-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage.slice(0, 12)} layout="vertical"><XAxis type="number" tickFormatter={(value) => compact(value)} hide /><YAxis type="category" dataKey="stageLabel" width={120} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} /><Tooltip formatter={(value) => money(value)} /><Bar dataKey="amount" fill="var(--workspace-accent)" radius={[0, 7, 7, 0]} /></BarChart></ResponsiveContainer></div></Panel><Panel title="Call outcomes" description="Disposition mix for calls in the selected period."><div className="erw-outcomes">{report.outcomes.calls.length === 0 ? <Empty /> : report.outcomes.calls.slice(0, 8).map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.value)}</span></div><i><b style={{ width: `${Math.max(3, row.value / Math.max(1, ...report.outcomes.calls.map((item) => item.value)) * 100)}%` }} /></i></article>)}</div></Panel></section> : null}

        {role.sections.includes('sources') ? <section className="erw-grid" id="sources"><Panel title="Lead source performance" description="Contacts, opportunities and wins by acquisition source."><div className="erw-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.leadSourcePerformance.slice(0, 8)} margin={{ top: 6, right: 8, left: -14, bottom: 36 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" /><XAxis dataKey="key" angle={-28} textAnchor="end" interval={0} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltip />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="contacts" fill="var(--workspace-accent)" radius={[5, 5, 0, 0]} /><Bar dataKey="opportunities" fill="#14b8a6" radius={[5, 5, 0, 0]} /><Bar dataKey="won" fill="#22c55e" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel><Panel title="Market distribution" description="Contact concentration across countries and commercial markets."><div className="erw-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.countryDistribution} dataKey="value" nameKey="key" innerRadius={68} outerRadius={108} paddingAngle={2}>{report.countryDistribution.map((row, index) => <Cell key={row.key} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}</Pie><Tooltip formatter={(value) => integer(value)} /><Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer></div></Panel></section> : null}

        {role.sections.includes('team') ? <section id="team"><Panel title="Team performance & quota attainment" description="Owner-level activity, revenue, targets and conversion." action={<span className="erw-chip">{intelligence.owners.length} owners</span>}><div className="erw-owner-table"><div className="erw-owner-head"><span>Owner</span><span>Calls</span><span>Meetings</span><span>Won revenue</span><span>Revenue target</span><span>Attainment</span></div>{intelligence.owners.length === 0 ? <Empty>No owner performance matches the filters.</Empty> : intelligence.owners.map((owner) => <article key={owner.ownerId}><span><i>{initials(owner.ownerName)}</i><div><strong>{owner.ownerName}</strong><small>{owner.ownerId}</small></div></span><b>{integer(owner.calls)}</b><b>{integer(owner.meetings)}</b><b>{money(owner.wonRevenue)}</b><b>{money(owner.revenueTarget)}</b><span className={`erw-attainment ${(owner.revenueAttainment || 0) >= 100 ? 'good' : (owner.revenueAttainment || 0) >= 70 ? 'warn' : 'bad'}`}>{owner.revenueAttainment === null ? 'Not set' : percentage(owner.revenueAttainment)}</span></article>)}</div></Panel></section> : null}

        {role.sections.includes('quality') ? <section className="erw-grid" id="quality"><Panel title="CRM data quality" description="Completeness across the fields required for reliable reporting." action={<span className="erw-chip">{percentage(quality.score)}</span>}><div className="erw-quality">{quality.fields.map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.complete)} complete · {integer(row.missing)} missing</span><b>{percentage(row.percentage)}</b></div><i><b style={{ width: `${Math.max(0, Math.min(100, row.percentage))}%` }} /></i></article>)}</div></Panel><Panel title="Task execution status" description="Current task-status distribution for the reporting period."><div className="erw-outcomes">{report.outcomes.tasks.length === 0 ? <Empty /> : report.outcomes.tasks.slice(0, 8).map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.value)}</span></div><i><b style={{ width: `${Math.max(3, row.value / Math.max(1, ...report.outcomes.tasks.map((item) => item.value)) * 100)}%` }} /></i></article>)}</div></Panel></section> : null}

        <section className="erw-footprint"><div><Layers3 size={19} /><span>Active filters</span><strong>{[filters.ownerId, filters.country, filters.pipelineId, filters.stageId, filters.leadSource].filter(Boolean).length + 1}</strong></div><div><BarChart3 size={19} /><span>Command role</span><strong>{role.label}</strong></div><div><Database size={19} /><span>Generated</span><strong>{new Date(report.generatedAt).toLocaleTimeString(locale)}</strong></div><div><Building2 size={19} /><span>Workspace</span><strong>{workspace.name}</strong></div></section>
      </section>

      {drilldown ? <div className="erw-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDrilldown(null)}><aside className="erw-drawer"><header><div><span>{titleCase(drilldown.objectType)} REPORT</span><h2>{drillTitle}</h2><p>Live CRM records behind the selected metric with current filters and tenant scope applied.</p></div><button onClick={() => setDrilldown(null)}><X size={18} /></button></header><div className="erw-drawer-table"><div className="erw-drawer-head"><span>Record</span><span>Owner / status</span><span>Company / pipeline</span><span>Last activity</span></div>{drilldown.results.map((row) => { const p = row.properties || {}; const name = p.dealname || [p.firstname, p.lastname].filter(Boolean).join(' ') || p.hs_task_subject || p.hs_call_title || p.hs_meeting_title || `Record ${row.id}`; const objectPath = drilldown.objectType === 'contacts' ? 'contact' : drilldown.objectType === 'deals' ? 'deal' : ''; const url = objectPath && workspace.portal_id ? `https://app.hubspot.com/contacts/${workspace.portal_id}/${objectPath}/${row.id}` : null; return <article key={row.id}><span>{url ? <a href={url} target="_blank" rel="noreferrer"><strong>{name}</strong><small>{p.email || p.amount || `HubSpot ID ${row.id}`}</small></a> : <><strong>{name}</strong><small>{p.email || `CRM record ${row.id}`}</small></>}</span><span><strong>{p.hubspot_owner_id || p.hs_activity_assigned_to_user_id || 'Unassigned'}</strong><small>{titleCase(p.hs_lead_status || p.hs_task_status || p.hs_call_status || p.hs_meeting_outcome || p.dealstage)}</small></span><span><strong>{p.company || p.pipeline || '—'}</strong><small>{p.country || p.jobtitle || p.hs_task_priority || '—'}</small></span><span><strong>{p.notes_last_contacted || p.hs_timestamp || p.closedate || '—'}</strong><small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleDateString(locale)}` : 'Live CRM record'}</small></span></article>; })}{drilldown.results.length === 0 ? <Empty /> : null}</div><footer><button onClick={() => loadDrilldown(drillKey, drillTitle, Math.max(0, drilldown.offset - drilldown.limit))} disabled={isPending || drilldown.offset === 0}><ChevronLeft size={15} />Previous</button><span>{drilldown.offset + 1}–{drilldown.offset + drilldown.results.length}</span><button onClick={() => loadDrilldown(drillKey, drillTitle, drilldown.offset + drilldown.limit)} disabled={isPending || !drilldown.hasMore}>Next<ChevronRight size={15} /></button></footer></aside></div> : null}
    </main>
  );
}
