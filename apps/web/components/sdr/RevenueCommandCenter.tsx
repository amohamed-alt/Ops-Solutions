'use client';

import { useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Database,
  Filter,
  Gauge,
  Globe2,
  Layers3,
  ListTodo,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Target,
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

type RevenuePayload = { workspace: WorkspaceState['workspace']; report: Report };
type Drilldown = {
  key: string;
  objectType: string;
  columns: string[];
  limit: number;
  offset: number;
  hasMore: boolean;
  results: Array<{ id: string; properties: Record<string, string | undefined>; hubspotCreatedAt?: string | null; hubspotUpdatedAt?: string | null; syncedAt?: string | null }>;
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

const pieColors = ['#5b67f1', '#14b8a6', '#f59e0b', '#8b5cf6', '#ec4899', '#0ea5e9', '#22c55e', '#f97316', '#64748b', '#ef4444', '#06b6d4', '#a855f7'];

function dateInput(daysAgo: number) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

const defaultFilters: Filters = {
  from: dateInput(29),
  to: dateInput(0),
  ownerId: '',
  country: '',
  pipelineId: '',
  stageId: '',
  leadSource: ''
};

function compact(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
}

function integer(value: number) {
  return new Intl.NumberFormat('en').format(Number(value || 0));
}

function percentage(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function titleCase(value: string) {
  return String(value || 'Unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function queryString(filters: Filters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  return params.toString();
}

function Delta({ comparison }: { comparison?: Comparison }) {
  if (!comparison) return <span className="ric-delta neutral">Snapshot</span>;
  if (comparison.deltaPercent === null) return <span className="ric-delta up"><ArrowUpRight size={12} />New</span>;
  const up = comparison.deltaPercent >= 0;
  return <span className={`ric-delta ${up ? 'up' : 'down'}`}>{up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(comparison.deltaPercent).toFixed(1)}%</span>;
}

function KpiCard({ item, onOpen }: { item: Kpi; onOpen: (key: string, title: string) => void }) {
  const Icon = item.icon;
  const formatted = item.percent ? percentage(item.value) : item.amount ? compact(item.value) : integer(item.value);
  const Tag = item.drilldown ? 'button' : 'article';
  return (
    <Tag className={`ric-kpi ric-tone-${item.tone}`} onClick={() => item.drilldown && onOpen(item.drilldown, item.label)}>
      <div className="ric-kpi-top"><span><Icon size={17} /></span><Delta comparison={item.comparison} /></div>
      <strong>{formatted}</strong>
      <h3>{item.label}</h3>
      <p>{item.helper}</p>
    </Tag>
  );
}

function Panel({ title, description, action, children, id }: { title: string; description: string; action?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="ric-panel" id={id}><header><div><h2>{title}</h2><p>{description}</p></div>{action}</header><div className="ric-panel-body">{children}</div></section>;
}

function TooltipCard({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return <div className="ric-tooltip"><strong>{label}</strong>{payload.map((row: any) => <span key={row.dataKey}><i style={{ background: row.color }} />{titleCase(row.name || row.dataKey)}<b>{integer(row.value)}</b></span>)}</div>;
}

function OutcomeList({ rows }: { rows: Array<{ key: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <div className="ric-outcome-list">{rows.slice(0, 7).map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.value)}</span></div><i><b style={{ width: `${Math.max(3, row.value / max * 100)}%` }} /></i></article>)}{rows.length === 0 ? <div className="ric-empty">No records match the selected filters.</div> : null}</div>;
}

function RecordLabel({ row }: { row: Drilldown['results'][number] }) {
  const p = row.properties || {};
  if (p.firstname || p.lastname) return <><strong>{[p.firstname, p.lastname].filter(Boolean).join(' ')}</strong><small>{p.email || p.company || `HubSpot ID ${row.id}`}</small></>;
  if (p.dealname) return <><strong>{p.dealname}</strong><small>{p.amount ? `Amount ${p.amount}` : `HubSpot ID ${row.id}`}</small></>;
  return <><strong>{p.hs_task_subject || p.hs_call_title || p.hs_meeting_title || `Record ${row.id}`}</strong><small>{p.hs_task_status || p.hs_call_status || p.hs_meeting_outcome || 'CRM record'}</small></>;
}

function DrilldownDrawer({ drilldown, title, portalId, loading, onClose, onPage }: { drilldown: Drilldown | null; title: string; portalId?: string | number | null; loading: boolean; onClose: () => void; onPage: (offset: number) => void }) {
  if (!drilldown) return null;
  return <div className="ric-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="ric-drawer"><header><div><span>{titleCase(drilldown.objectType)} report</span><h2>{title}</h2><p>Live records behind the selected report, with the current filters applied.</p></div><button onClick={onClose}><X size={18} /></button></header><div className="ric-drawer-table"><div className="ric-drawer-head"><span>Record</span><span>Owner / Status</span><span>Company / Pipeline</span><span>Last activity</span></div>{drilldown.results.map((row) => { const p = row.properties || {}; const contactUrl = drilldown.objectType === 'contacts' && portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${row.id}` : null; const dealUrl = drilldown.objectType === 'deals' && portalId ? `https://app.hubspot.com/contacts/${portalId}/deal/${row.id}` : null; const url = contactUrl || dealUrl; return <article key={row.id}><span className="ric-record-main">{url ? <a href={url} target="_blank" rel="noreferrer"><RecordLabel row={row} /></a> : <RecordLabel row={row} />}</span><span><strong>{p.hubspot_owner_id || p.hs_activity_assigned_to_user_id || 'Unassigned'}</strong><small>{titleCase(p.hs_lead_status || p.hs_task_status || p.hs_call_status || p.hs_meeting_outcome || p.dealstage || 'Unknown')}</small></span><span><strong>{p.company || p.pipeline || '—'}</strong><small>{p.country || p.jobtitle || p.hs_task_priority || '—'}</small></span><span><strong>{p.notes_last_contacted || p.hs_timestamp || p.closedate || '—'}</strong><small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleDateString()}` : 'Live CRM record'}</small></span></article>; })}{drilldown.results.length === 0 ? <div className="ric-empty">No records match this report.</div> : null}</div><footer><button onClick={() => onPage(Math.max(0, drilldown.offset - drilldown.limit))} disabled={loading || drilldown.offset === 0}><ChevronLeft size={15} />Previous</button><span>{drilldown.offset + 1}–{drilldown.offset + drilldown.results.length}</span><button onClick={() => onPage(drilldown.offset + drilldown.limit)} disabled={loading || !drilldown.hasMore}>Next<ChevronRight size={15} /></button></footer></aside></div>;
}

export function RevenueCommandCenter() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState<RevenuePayload | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [filterOpen, setFilterOpen] = useState(true);
  const [message, setMessage] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillTitle, setDrillTitle] = useState('Report details');
  const [drillKey, setDrillKey] = useState('');
  const [isPending, startTransition] = useTransition();

  const selectedState = useMemo(() => workspaces.find((row) => row.workspace.id === selectedId) ?? null, [workspaces, selectedId]);
  const workspace = selectedState?.workspace;
  const report = payload?.report;
  const stages = useMemo(() => (report?.filterOptions.stages ?? []).filter((row) => !draft.pipelineId || row.pipelineId === draft.pipelineId), [report, draft.pipelineId]);

  async function readWorkspaces() {
    const response = await fetch('/api/customer/workspaces', { cache: 'no-store' });
    if (response.status === 401) { router.replace('/onboarding'); return []; }
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load company workspaces.');
    return (result.results ?? []).filter((row: WorkspaceState) => row.workspace.hubspot_status === 'connected') as WorkspaceState[];
  }

  async function readReport(workspaceId: string, nextFilters: Filters) {
    const response = await fetch(`/api/dashboard/${workspaceId}/reports?${queryString(nextFilters)}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to build the reporting workspace.');
    setPayload(result);
    return result as RevenuePayload;
  }

  useEffect(() => {
    let active = true;
    startTransition(async () => {
      try {
        const rows = await readWorkspaces();
        if (!active) return;
        const id = rows[0]?.workspace.id;
        if (!id) { router.replace('/onboarding'); return; }
        setWorkspaces(rows);
        setSelectedId(id);
        await readReport(id, filters);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open reports.');
      } finally {
        if (active) setInitialized(true);
      }
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectWorkspace(id: string) {
    setSelectedId(id);
    setPayload(null);
    setDrilldown(null);
    setMessage('');
    startTransition(() => readReport(id, filters).catch((error) => setMessage(error.message)));
  }

  function applyFilters() {
    if (!selectedId) return;
    setFilters(draft);
    setDrilldown(null);
    setMessage('');
    startTransition(() => readReport(selectedId, draft).catch((error) => setMessage(error.message)));
  }

  function resetFilters() {
    setDraft(defaultFilters);
    setFilters(defaultFilters);
    setDrilldown(null);
    if (selectedId) startTransition(() => readReport(selectedId, defaultFilters).catch((error) => setMessage(error.message)));
  }

  function refresh() {
    if (!selectedId) return;
    setMessage('');
    startTransition(async () => {
      try {
        const rows = await readWorkspaces();
        setWorkspaces(rows);
        await readReport(selectedId, filters);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to refresh reports.');
      }
    });
  }

  async function loadDrilldown(key: string, title: string, offset = 0) {
    if (!selectedId) return;
    setDrillKey(key);
    setDrillTitle(title);
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch(`/api/dashboard/${selectedId}/reports/${encodeURIComponent(key)}?${queryString(filters, { limit: 50, offset })}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.drilldown) throw new Error(result.message || 'Unable to load report details.');
        setDrilldown(result.drilldown);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to load report details.');
      }
    });
  }

  if (!initialized || !workspace || !report) {
    return <main className="ric-loading"><div><Database size={34} /><RefreshCw className="ric-spin" size={24} /></div><span>Building your command center</span><h1>Loading every report that matters.</h1><p>Verifying your customer session and compiling tenant-isolated HubSpot analytics.</p>{message ? <button onClick={() => router.push('/onboarding')}>Return to onboarding</button> : null}</main>;
  }

  const o = report.overview;
  const c = report.comparisons;
  const kpis: Kpi[] = [
    { label: 'Portfolio contacts', value: o.portfolioContacts, icon: UsersRound, tone: 'indigo', helper: `${integer(o.missingOwnerContacts)} without owner` },
    { label: 'New contacts', value: o.newContacts, icon: TrendingUp, tone: 'cyan', helper: `${report.filters.days}-day acquisition`, comparison: c.newContacts },
    { label: 'Calls', value: o.calls, icon: Phone, tone: 'teal', helper: 'Completed in selected period', comparison: c.calls, drilldown: 'calls' },
    { label: 'Meetings', value: o.meetings, icon: CalendarDays, tone: 'amber', helper: `${percentage(o.meetingRate)} per call`, comparison: c.meetings, drilldown: 'meetings' },
    { label: 'Meeting rate', value: o.meetingRate, icon: Target, tone: 'violet', helper: 'Calls converted to meetings', percent: true },
    { label: 'Completed tasks', value: o.completedTasks, icon: CheckCircle2, tone: 'green', helper: `${integer(o.openTasks)} still open`, comparison: c.completedTasks },
    { label: 'Open deals', value: o.openDeals, icon: BriefcaseBusiness, tone: 'indigo', helper: `${integer(o.dealsAtRisk)} currently at risk`, drilldown: 'open-deals' },
    { label: 'Open pipeline', value: o.openPipeline, icon: CircleDollarSign, tone: 'cyan', helper: 'CRM currency', amount: true },
    { label: 'Won deals', value: o.wonDeals, icon: Gauge, tone: 'green', helper: 'Closed won in period', comparison: c.wonDeals, drilldown: 'won-deals' },
    { label: 'Won revenue', value: o.wonRevenue, icon: TrendingUp, tone: 'teal', helper: 'Closed-won value', comparison: c.wonRevenue, amount: true },
    { label: 'Overdue tasks', value: o.overdueTasks, icon: ListTodo, tone: 'red', helper: `${integer(o.tasksDueToday)} due today`, drilldown: 'overdue-tasks' },
    { label: 'Deals at risk', value: o.dealsAtRisk, icon: AlertTriangle, tone: 'amber', helper: 'No next step or overdue close', drilldown: 'no-next-activity-deals' }
  ];

  const attentionCards = [
    ['untouched-contacts', 'Untouched contacts', report.attention.untouchedContacts, 'No outreach after two days', UsersRound],
    ['stale-contacts', 'Stale contacts', report.attention.staleContacts, 'No contact for 21+ days', Activity],
    ['missing-owner-contacts', 'Missing owner', report.attention.missingOwnerContacts, 'Contacts awaiting assignment', ShieldCheck],
    ['overdue-tasks', 'Overdue tasks', report.attention.overdueTasks, 'Open tasks past due', ListTodo],
    ['no-next-activity-deals', 'No next activity', report.attention.noNextActivityDeals, 'Open deals with no planned step', BriefcaseBusiness],
    ['overdue-close-deals', 'Overdue close date', report.attention.overdueCloseDeals, 'Open deals beyond close date', CalendarDays]
  ] as const;

  const executiveInsight = o.dealsAtRisk > 0
    ? `${integer(o.dealsAtRisk)} open deals need intervention while ${compact(o.openPipeline)} remains exposed in pipeline.`
    : `${integer(o.meetings)} meetings and ${integer(o.wonDeals)} wins were recorded with no current deal-risk alerts.`;

  return <main className="ric-shell">
    <aside className="ric-sidebar">
      <div className="ric-brand"><span>{workspace.name.slice(0, 1).toUpperCase()}</span><div><strong>{workspace.name}</strong><small>Revenue Intelligence</small></div></div>
      <div className="ric-nav-label">COMMAND CENTER</div>
      <nav>{[
        ['overview', 'Executive overview', Gauge],
        ['activity', 'Activity performance', Activity],
        ['pipeline', 'Pipeline & revenue', BriefcaseBusiness],
        ['sources', 'Sources & markets', Globe2],
        ['team', 'Team performance', UsersRound],
        ['quality', 'Data quality', ShieldCheck]
      ].map(([id, label, Icon]) => <button key={String(id)} onClick={() => document.getElementById(String(id))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><Icon size={16} /><span>{String(label)}</span><ChevronRight size={14} /></button>)}</nav>
      <div className="ric-nav-label">COMPANIES</div>
      <div className="ric-workspaces">{workspaces.map((row) => <button key={row.workspace.id} className={row.workspace.id === selectedId ? 'active' : ''} onClick={() => selectWorkspace(row.workspace.id)}><i>{row.workspace.name.slice(0, 2).toUpperCase()}</i><span>{row.workspace.name}</span><b /></button>)}</div>
      <div className="ric-sync"><Database size={16} /><div><strong>Live HubSpot data</strong><span>{selectedState?.freshness?.newest_record_sync ? new Date(String(selectedState.freshness.newest_record_sync)).toLocaleString() : 'Sync pending'}</span></div></div>
    </aside>

    <header className="ric-topbar"><div><strong>Revenue Command Center</strong><span>{report.filters.from} → {report.filters.to} · {report.filters.days} days</span></div><div><span className="ric-live"><i />LIVE · HUBSPOT</span><button className={filterOpen ? 'active' : ''} onClick={() => setFilterOpen((value) => !value)}><Filter size={16} />Filters</button><button className="primary" onClick={refresh} disabled={isPending}><RefreshCw size={16} className={isPending ? 'ric-spin' : ''} />{isPending ? 'Refreshing' : 'Refresh'}</button></div></header>

    <section className="ric-content">
      <section className="ric-heading" id="overview"><div><span>EXECUTIVE INTELLIGENCE</span><h1>See the whole revenue operation.</h1><p>{executiveInsight}</p></div><div className="ric-score"><ShieldCheck size={20} /><div><strong>{percentage(report.dataQuality.score)}</strong><span>CRM quality score</span></div></div></section>

      {filterOpen ? <section className="ric-filterbar"><label><span>From</span><input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label><label><span>To</span><input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label><label><span>Owner</span><select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}><option value="">All owners</option>{report.filterOptions.owners.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label><span>Country</span><select value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}><option value="">All countries</option>{report.filterOptions.countries.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label><label><span>Pipeline</span><select value={draft.pipelineId} onChange={(event) => setDraft({ ...draft, pipelineId: event.target.value, stageId: '' })}><option value="">All pipelines</option>{report.filterOptions.pipelines.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label><span>Stage</span><select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}><option value="">All stages</option>{stages.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label><label><span>Lead source</span><select value={draft.leadSource} onChange={(event) => setDraft({ ...draft, leadSource: event.target.value })}><option value="">All sources</option>{report.filterOptions.leadSources.map((row) => <option key={row.value} value={row.value}>{titleCase(row.value)} · {integer(row.count)}</option>)}</select></label><div className="ric-filter-actions"><button onClick={resetFilters}><RotateCcw size={15} />Reset</button><button className="primary" onClick={applyFilters} disabled={isPending}><Search size={15} />Apply filters</button></div></section> : null}
      {message ? <div className="ric-message">{message}</div> : null}

      <section className="ric-kpi-grid">{kpis.map((item) => <KpiCard key={item.label} item={item} onOpen={(key, title) => loadDrilldown(key, title)} />)}</section>

      <section className="ric-attention"><header><div><span>WHAT NEEDS ATTENTION NOW</span><h2>Action queue</h2></div><b>{integer(Object.values(report.attention).reduce((sum, value) => sum + Number(value || 0), 0))} signals</b></header><div>{attentionCards.map(([key, label, value, helper, Icon]) => <button key={key} onClick={() => loadDrilldown(key, label)}><span><Icon size={18} /></span><div><strong>{integer(Number(value || 0))}</strong><h3>{label}</h3><p>{helper}</p></div><ChevronRight size={16} /></button>)}</div></section>

      <section className="ric-grid ric-grid-wide" id="activity">
        <Panel title="Activity performance" description="Calls, meetings and tasks across the selected reporting period." action={<span className="ric-chip">Compared with {report.comparisonPeriod.from} → {report.comparisonPeriod.to}</span>}><div className="ric-chart large"><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.activityTrend} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}><defs><linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5b67f1" stopOpacity={0.34} /><stop offset="100%" stopColor="#5b67f1" stopOpacity={0} /></linearGradient><linearGradient id="tasksFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.25} /><stop offset="100%" stopColor="#14b8a6" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" /><XAxis dataKey="day" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><Tooltip content={<TooltipCard />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /><Area type="monotone" dataKey="calls" stroke="#5b67f1" fill="url(#callsFill)" strokeWidth={2.5} /><Area type="monotone" dataKey="tasks" stroke="#14b8a6" fill="url(#tasksFill)" strokeWidth={2} /><Area type="monotone" dataKey="meetings" stroke="#f59e0b" fill="transparent" strokeWidth={2.5} /></AreaChart></ResponsiveContainer></div></Panel>
        <Panel title="Pipeline by stage" description="Open deal volume and value across active stages." action={<span className="ric-chip">{compact(o.openPipeline)} exposed</span>} id="pipeline"><div className="ric-chart large"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage.slice(0, 12)} layout="vertical" margin={{ top: 0, right: 18, left: 10, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e8edf5" /><XAxis type="number" tickFormatter={compact} tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="stageLabel" width={112} tick={{ fontSize: 10, fill: '#536176' }} axisLine={false} tickLine={false} /><Tooltip formatter={(value: number) => compact(value)} /><Bar dataKey="amount" radius={[0, 7, 7, 0]} fill="#5b67f1" /></BarChart></ResponsiveContainer></div></Panel>
      </section>

      <section className="ric-grid" id="sources">
        <Panel title="Lead source performance" description="Contacts, opportunities and wins by acquisition source."><div className="ric-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.leadSourcePerformance.slice(0, 8)} margin={{ top: 6, right: 8, left: -14, bottom: 36 }}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8edf5" /><XAxis dataKey="key" angle={-28} textAnchor="end" interval={0} tick={{ fontSize: 9, fill: '#64748b' }} axisLine={false} tickLine={false} /><YAxis tick={{ fontSize: 10, fill: '#8490a3' }} axisLine={false} tickLine={false} /><Tooltip content={<TooltipCard />} /><Legend iconType="circle" wrapperStyle={{ fontSize: 10 }} /><Bar dataKey="contacts" fill="#5b67f1" radius={[5,5,0,0]} /><Bar dataKey="opportunities" fill="#14b8a6" radius={[5,5,0,0]} /><Bar dataKey="won" fill="#22c55e" radius={[5,5,0,0]} /></BarChart></ResponsiveContainer></div></Panel>
        <Panel title="Market distribution" description="Contact concentration across countries and commercial markets."><div className="ric-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.countryDistribution} dataKey="value" nameKey="key" innerRadius={68} outerRadius={105} paddingAngle={2}>{report.countryDistribution.map((row, index) => <Cell key={row.key} fill={pieColors[index % pieColors.length]} />)}</Pie><Tooltip formatter={(value: number) => integer(value)} /><Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 10 }} /></PieChart></ResponsiveContainer></div></Panel>
      </section>

      <section className="ric-grid ric-grid-wide" id="team">
        <Panel title="Team performance" description="Owner-level activity, conversion, open pipeline and won revenue." action={<span className="ric-chip">{report.ownerPerformance.length} owners</span>}><div className="ric-owner-table"><div className="ric-owner-head"><span>Owner</span><span>Calls</span><span>Meetings</span><span>Rate</span><span>Open deals</span><span>Pipeline</span><span>Won revenue</span></div>{report.ownerPerformance.map((row, index) => <article key={`${row.ownerId}-${index}`}><span><i>{row.ownerName.slice(0,2).toUpperCase()}</i><div><strong>{row.ownerName}</strong><small>{row.email || row.ownerId}</small></div></span><b>{integer(row.calls)}</b><b>{integer(row.meetings)}</b><b>{percentage(row.meetingRate)}</b><b>{integer(row.openDeals)}</b><b>{compact(row.openPipeline)}</b><b>{compact(row.wonRevenue)}</b></article>)}{report.ownerPerformance.length === 0 ? <div className="ric-empty">No owner activity matches the selected filters.</div> : null}</div></Panel>
        <div className="ric-stack"><Panel title="Call outcomes" description="Disposition mix for calls in the selected period."><OutcomeList rows={report.outcomes.calls} /></Panel><Panel title="Meeting outcomes" description="Completion and outcome mix for meetings."><OutcomeList rows={report.outcomes.meetings} /></Panel></div>
      </section>

      <section className="ric-grid" id="quality">
        <Panel title="CRM data quality" description="Completeness across the fields needed for reliable reporting." action={<span className="ric-score-pill">{percentage(report.dataQuality.score)}</span>}><div className="ric-quality-list">{report.dataQuality.fields.map((row) => <article key={row.key}><div><strong>{titleCase(row.key)}</strong><span>{integer(row.complete)} complete · {integer(row.missing)} missing</span><b>{percentage(row.percentage)}</b></div><i><b style={{ width: `${Math.max(0, Math.min(100, row.percentage))}%` }} /></i></article>)}</div></Panel>
        <Panel title="Task execution status" description="Current task-status distribution for the reporting period."><OutcomeList rows={report.outcomes.tasks} /></Panel>
      </section>

      <section className="ric-footprint"><div><Layers3 size={18} /><span>Active filters</span><strong>{[filters.ownerId, filters.country, filters.pipelineId, filters.stageId, filters.leadSource].filter(Boolean).length + 1}</strong></div><div><BarChart3 size={18} /><span>Report modules</span><strong>14</strong></div><div><Database size={18} /><span>Generated</span><strong>{new Date(report.generatedAt).toLocaleTimeString()}</strong></div><div><Building2 size={18} /><span>Workspace</span><strong>{workspace.name}</strong></div></section>
    </section>

    <DrilldownDrawer drilldown={drilldown} title={drillTitle || titleCase(drillKey)} portalId={workspace.portal_id} loading={isPending} onClose={() => setDrilldown(null)} onPage={(offset) => loadDrilldown(drillKey, drillTitle, offset)} />
  </main>;
}
