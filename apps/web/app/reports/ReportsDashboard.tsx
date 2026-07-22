'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, BriefcaseBusiness,
  Building2, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign,
  Database, Filter, LoaderCircle, Phone, RefreshCw, Search, ShieldCheck, Target, UsersRound, X
} from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';

import styles from './reports.module.css';

type Option = { id?: string; value?: string; label?: string; count?: number; pipelineId?: string; email?: string | null };
type Filters = { from: string; to: string; ownerId: string; country: string; pipelineId: string; stageId: string; leadSource: string };
type Metric = { current: number; previous: number; deltaPercent: number | null };
type Drilldown = { key: string; objectType: string; columns: string[]; limit: number; offset: number; hasMore: boolean; results: Array<{ id: string; properties: Record<string, string | undefined> }> };
type Report = {
  generatedAt: string;
  filters: Filters & { days: number };
  comparisonPeriod: { from: string; to: string };
  filterOptions: { owners: Option[]; countries: Option[]; leadSources: Option[]; pipelines: Option[]; stages: Option[] };
  overview: Record<string, number>;
  comparisons: Record<string, Metric>;
  activityTrend: Array<{ day: string; calls: number; meetings: number; tasks: number }>;
  pipelineByStage: Array<Record<string, string | number>>;
  leadSourcePerformance: Array<Record<string, string | number>>;
  countryDistribution: Array<Record<string, string | number>>;
  ownerPerformance: Array<Record<string, string | number | null>>;
  outcomes: Record<string, Array<{ key: string; value: number }>>;
  dataQuality: { totalContacts: number; score: number; fields: Array<{ key: string; complete: number; missing: number; percentage: number }> };
  attention: Record<string, number>;
};
type Payload = { workspace?: { id: string; name: string; portal_id?: number | string | null }; report?: Report; message?: string };

const today = new Date().toISOString().slice(0, 10);
const defaultFrom = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
const emptyFilters: Filters = { from: defaultFrom, to: today, ownerId: '', country: '', pipelineId: '', stageId: '', leadSource: '' };
const reportLabels: Record<string, string> = {
  'untouched-contacts': 'Untouched contacts', 'stale-contacts': 'Stale contacts',
  'missing-owner-contacts': 'Contacts missing owner', 'overdue-tasks': 'Overdue tasks',
  'no-next-activity-deals': 'Deals without next activity', 'overdue-close-deals': 'Deals past close date',
  'open-deals': 'Open deals', 'won-deals': 'Closed won deals', calls: 'Calls', meetings: 'Meetings'
};
const colors = ['#0f766e', '#2563eb', '#7c3aed', '#d97706', '#dc2626', '#0891b2', '#4f46e5', '#65a30d'];

function compact(value: unknown) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en', { notation: Math.abs(number) >= 1000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number);
}
function money(value: unknown) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}
function humanize(value: string) {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function queryString(filters: Filters, extra: Record<string, string | number> = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
    if (String(value ?? '').trim()) params.set(key, String(value));
  });
  return params.toString();
}
function valueFrom(row: Record<string, string | number>, ...keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== null) return Number(row[key]) || 0;
  return 0;
}
function labelFrom(row: Record<string, string | number>, ...keys: string[]) {
  for (const key of keys) if (row[key]) return String(row[key]);
  return 'Unknown';
}

function Delta({ metric }: { metric?: Metric }) {
  if (!metric || metric.deltaPercent === null) return <span className={styles.deltaNeutral}>New period</span>;
  const positive = metric.deltaPercent >= 0;
  return <span className={positive ? styles.deltaPositive : styles.deltaNegative}>{positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}{Math.abs(metric.deltaPercent).toFixed(1)}%</span>;
}

function Kpi({ title, value, helper, metric, icon: Icon, moneyValue, onClick }: { title: string; value: number; helper: string; metric?: Metric; icon: typeof Activity; moneyValue?: boolean; onClick?: () => void }) {
  const Component = onClick ? 'button' : 'article';
  return <Component className={styles.kpi} onClick={onClick}><div className={styles.kpiTop}><span>{title}</span><Icon size={17} /></div><strong>{moneyValue ? money(value) : compact(value)}</strong><div className={styles.kpiBottom}><small>{helper}</small><Delta metric={metric} /></div></Component>;
}

export default function ReportsDashboard() {
  const router = useRouter();
  const [workspaceId, setWorkspaceId] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [drawer, setDrawer] = useState<{ key: string; data: Drilldown } | null>(null);
  const [drawerOffset, setDrawerOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const loadReport = useCallback(async (id: string, nextFilters: Filters) => {
    const response = await fetch(`/api/dashboard/${id}/reports?${queryString(nextFilters)}`, { cache: 'no-store' });
    if (response.status === 401) { router.replace('/onboarding'); return; }
    const result = await response.json() as Payload;
    if (!response.ok) throw new Error(result.message || 'Unable to load revenue reporting.');
    setPayload(result);
  }, [router]);

  useEffect(() => {
    startTransition(async () => {
      try {
        const response = await fetch('/api/customer/workspaces', { cache: 'no-store' });
        if (response.status === 401) { router.replace('/onboarding'); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to load workspace.');
        const connected = (result.results ?? []).find((row: { workspace?: { hubspot_status?: string } }) => row.workspace?.hubspot_status === 'connected');
        const id = connected?.workspace?.id;
        if (!id) { router.replace('/onboarding'); return; }
        setWorkspaceId(id);
        await loadReport(id, emptyFilters);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to open reports.'); }
    });
  }, [loadReport, router]);

  async function applyFilters() {
    if (!workspaceId) return;
    setMessage('');
    setFilters(draft);
    setDrawer(null);
    startTransition(() => loadReport(workspaceId, draft).catch((error) => setMessage(error.message)));
  }
  async function resetFilters() {
    setDraft(emptyFilters); setFilters(emptyFilters); setDrawer(null);
    if (workspaceId) startTransition(() => loadReport(workspaceId, emptyFilters).catch((error) => setMessage(error.message)));
  }
  async function openDrilldown(key: string, offset = 0) {
    if (!workspaceId) return;
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch(`/api/dashboard/${workspaceId}/reports/${key}?${queryString(filters, { limit: 50, offset })}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.drilldown) throw new Error(result.message || 'Unable to load report records.');
        setDrawer({ key, data: result.drilldown }); setDrawerOffset(offset); setSearch('');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load report records.'); }
    });
  }

  const report = payload?.report;
  const overview = report?.overview ?? {};
  const options = report?.filterOptions;
  const stages = useMemo(() => (options?.stages ?? []).filter((stage) => !draft.pipelineId || stage.pipelineId === draft.pipelineId), [options?.stages, draft.pipelineId]);
  const filteredRows = useMemo(() => {
    const rows = drawer?.data.results ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => Object.values(row.properties ?? {}).some((value) => String(value ?? '').toLowerCase().includes(needle)));
  }, [drawer, search]);

  if (!report) return <main className={styles.loading}><LoaderCircle className={styles.spin} size={34} /><strong>Building enterprise reports…</strong><span>{message || 'Loading live HubSpot analytics and filter dimensions.'}</span></main>;

  const kpis = [
    ['Portfolio contacts', Number(overview.portfolioContacts ?? 0), 'All contacts in scope', undefined, UsersRound, false, 'untouched-contacts'],
    ['New contacts', Number(overview.newContacts ?? 0), `${report.filters.days}-day acquisition`, report.comparisons.newContacts, Target, false, undefined],
    ['Calls', Number(overview.calls ?? 0), 'Activity in selected period', report.comparisons.calls, Phone, false, 'calls'],
    ['Meetings', Number(overview.meetings ?? 0), 'Meetings in selected period', report.comparisons.meetings, CalendarDays, false, 'meetings'],
    ['Open pipeline', Number(overview.openPipeline ?? 0), 'Current revenue exposure', undefined, CircleDollarSign, true, 'open-deals'],
    ['Won revenue', Number(overview.wonRevenue ?? 0), 'Closed won in period', report.comparisons.wonRevenue, CheckCircle2, true, 'won-deals'],
    ['Open deals', Number(overview.openDeals ?? 0), 'Active opportunities', undefined, BriefcaseBusiness, false, 'open-deals'],
    ['Completed tasks', Number(overview.completedTasks ?? 0), 'Execution completed', report.comparisons.completedTasks, ShieldCheck, false, undefined]
  ] as const;

  return <main className={styles.shell}>
    <header className={styles.header}><div><span className={styles.eyebrow}>ENTERPRISE REVENUE INTELLIGENCE</span><h1>{payload.workspace?.name || 'Company'} reporting center</h1><p>Executive performance, SDR execution, pipeline, attribution, quality and action queues from live HubSpot data.</p></div><button onClick={applyFilters} disabled={isPending}><RefreshCw className={isPending ? styles.spin : ''} size={16} />{isPending ? 'Refreshing…' : 'Refresh reports'}</button></header>

    <section className={styles.filters}><div className={styles.filterTitle}><Filter size={17} /><div><strong>Global filters</strong><span>Every metric, chart and drill-down uses the same tenant-scoped filter context.</span></div></div>
      <label><span>From</span><input type="date" value={draft.from} max={draft.to} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label><span>To</span><input type="date" value={draft.to} min={draft.from} max={today} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <label><span>Owner</span><select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}><option value="">All owners</option>{(options?.owners ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Country</span><select value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })}><option value="">All countries</option>{(options?.countries ?? []).map((item) => <option key={item.value} value={item.value}>{item.value} · {compact(item.count)}</option>)}</select></label>
      <label><span>Lead source</span><select value={draft.leadSource} onChange={(event) => setDraft({ ...draft, leadSource: event.target.value })}><option value="">All sources</option>{(options?.leadSources ?? []).map((item) => <option key={item.value} value={item.value}>{item.value} · {compact(item.count)}</option>)}</select></label>
      <label><span>Pipeline</span><select value={draft.pipelineId} onChange={(event) => setDraft({ ...draft, pipelineId: event.target.value, stageId: '' })}><option value="">All pipelines</option>{(options?.pipelines ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Stage</span><select value={draft.stageId} onChange={(event) => setDraft({ ...draft, stageId: event.target.value })}><option value="">All stages</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <div className={styles.filterActions}><button onClick={applyFilters} disabled={isPending}>Apply filters</button><button onClick={resetFilters} className={styles.secondary}>Reset</button></div>
    </section>

    {message ? <div className={styles.error}><AlertTriangle size={16} />{message}</div> : null}
    <section className={styles.kpis}>{kpis.map(([title, value, helper, metric, Icon, moneyValue, drill]) => <Kpi key={title} title={title} value={value} helper={helper} metric={metric} icon={Icon} moneyValue={moneyValue} onClick={drill ? () => openDrilldown(drill) : undefined} />)}</section>

    <section className={styles.attention}><div><span className={styles.eyebrow}>ACTION CENTER</span><h2>What needs attention now</h2></div><div className={styles.attentionGrid}>{[
      ['untouched-contacts','Untouched contacts','No outreach after two days',report.attention.untouchedContacts],
      ['stale-contacts','Stale contacts','No recent contact in 21 days',report.attention.staleContacts],
      ['missing-owner-contacts','Missing owners','Contacts without assignment',report.attention.missingOwnerContacts],
      ['overdue-tasks','Overdue tasks','Execution past due date',report.attention.overdueTasks],
      ['no-next-activity-deals','No next activity','Open deals without next step',report.attention.noNextActivityDeals],
      ['overdue-close-deals','Past close date','Open deals beyond close date',report.attention.overdueCloseDeals]
    ].map(([key,title,detail,value]) => <button key={String(key)} onClick={() => openDrilldown(String(key))}><AlertTriangle size={16} /><div><strong>{compact(value)}</strong><span>{title}</span><small>{detail}</small></div><ChevronRight size={16} /></button>)}</div></section>

    <section className={styles.gridTwo}>
      <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Activity trend</h2><p>Calls, meetings and tasks across the selected period.</p></div><Activity size={18} /></div><div className={styles.chart}><ResponsiveContainer width="100%" height="100%"><AreaChart data={report.activityTrend}><defs><linearGradient id="callsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0f766e" stopOpacity={0.28}/><stop offset="95%" stopColor="#0f766e" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="day" tickFormatter={(value) => String(value).slice(5)} /><YAxis width={38}/><Tooltip/><Area type="monotone" dataKey="calls" stroke="#0f766e" fill="url(#callsFill)" strokeWidth={2}/><Area type="monotone" dataKey="tasks" stroke="#2563eb" fillOpacity={0} strokeWidth={2}/><Area type="monotone" dataKey="meetings" stroke="#d97706" fillOpacity={0} strokeWidth={2}/></AreaChart></ResponsiveContainer></div></article>
      <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Pipeline by stage</h2><p>Deal count and revenue exposure by current stage.</p></div><BriefcaseBusiness size={18} /></div><div className={styles.chart}><ResponsiveContainer width="100%" height="100%"><BarChart data={report.pipelineByStage.slice(0, 10)} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis dataKey={(row) => labelFrom(row,'stageLabel','label','stage')} type="category" width={100} tick={{fontSize:10}}/><Tooltip/><Bar dataKey={(row) => valueFrom(row,'amount','pipeline','value','openPipeline')} fill="#2563eb" radius={[0,6,6,0]} /></BarChart></ResponsiveContainer></div></article>
    </section>

    <section className={styles.gridThree}>
      <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Lead source performance</h2><p>Acquisition and downstream revenue by source.</p></div><Target size={18}/></div><div className={styles.ranked}>{report.leadSourcePerformance.slice(0,8).map((row,index) => <div key={labelFrom(row,'source','key','label')}><i style={{background:colors[index%colors.length]}}/><span>{labelFrom(row,'source','key','label')}</span><strong>{compact(valueFrom(row,'contacts','value','count'))}</strong><small>{money(valueFrom(row,'wonRevenue','revenue','amount'))}</small></div>)}</div></article>
      <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Country distribution</h2><p>Contact portfolio by market.</p></div><Building2 size={18}/></div><div className={styles.pie}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.countryDistribution.slice(0,8)} dataKey={(row) => valueFrom(row,'value','contacts','count')} nameKey={(row) => labelFrom(row,'country','key','label')} innerRadius={54} outerRadius={82} paddingAngle={2}>{report.countryDistribution.slice(0,8).map((_,index)=><Cell key={index} fill={colors[index%colors.length]}/>)}</Pie><Tooltip/></PieChart></ResponsiveContainer></div></article>
      <article className={styles.panel}><div className={styles.panelTitle}><div><h2>Data quality</h2><p>CRM field completeness across contacts.</p></div><Database size={18}/></div><div className={styles.score}><strong>{report.dataQuality.score.toFixed(0)}%</strong><span>overall completeness</span></div><div className={styles.quality}>{report.dataQuality.fields.map((field)=><div key={field.key}><span>{humanize(field.key)}</span><b>{field.percentage.toFixed(0)}%</b><i><em style={{width:`${field.percentage}%`}}/></i></div>)}</div></article>
    </section>

    <section className={styles.panel}><div className={styles.panelTitle}><div><h2>Team performance</h2><p>Owner-level activity, meeting conversion, pipeline and won revenue.</p></div><UsersRound size={18}/></div><div className={styles.ownerTable}><div className={styles.ownerHeader}><span>Owner</span><span>Calls</span><span>Meetings</span><span>Rate</span><span>Tasks</span><span>Open deals</span><span>Pipeline</span><span>Won revenue</span></div>{report.ownerPerformance.map((row)=><div key={String(row.ownerId)}><span><strong>{String(row.ownerName||'Unassigned')}</strong><small>{String(row.email||'')}</small></span><span>{compact(row.calls)}</span><span>{compact(row.meetings)}</span><span>{Number(row.meetingRate||0).toFixed(1)}%</span><span>{compact(row.tasks)}</span><span>{compact(row.openDeals)}</span><span>{money(row.openPipeline)}</span><span>{money(row.wonRevenue)}</span></div>)}</div></section>

    {drawer ? <div className={styles.drawerBackdrop} onMouseDown={(event)=>{if(event.currentTarget===event.target)setDrawer(null);}}><aside className={styles.drawer}><header><div><span className={styles.eyebrow}>LIVE HUBSPOT RECORDS</span><h2>{reportLabels[drawer.key] || humanize(drawer.key)}</h2><p>{drawer.data.objectType} matching the active global filters.</p></div><button onClick={()=>setDrawer(null)}><X size={20}/></button></header><div className={styles.drawerSearch}><Search size={16}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search loaded records…"/></div><div className={styles.records}>{filteredRows.map((row)=>{const p=row.properties||{};const title=p.dealname||p.firstname&&`${p.firstname} ${p.lastname||''}`||p.hs_task_subject||p.hs_call_title||p.hs_meeting_title||`${humanize(drawer.data.objectType)} ${row.id}`;const portal=payload.workspace?.portal_id;const objectPath=drawer.data.objectType==='contacts'?'contact':drawer.data.objectType==='deals'?'deal':drawer.data.objectType;const url=portal?`https://app.hubspot.com/contacts/${portal}/${objectPath}/${row.id}`:null;return <article key={row.id}><div><strong>{title}</strong><span>{p.company||p.email||p.hs_call_status||p.hs_meeting_outcome||p.hs_task_status||`HubSpot ID ${row.id}`}</span></div><div className={styles.recordTags}>{drawer.data.columns.slice(0,5).map((column)=>p[column]?<span key={column}>{humanize(column)}: {p[column]}</span>:null)}</div>{url?<a href={url} target="_blank" rel="noreferrer">Open in HubSpot <ArrowUpRight size={13}/></a>:null}</article>})}{!filteredRows.length?<div className={styles.empty}>No records match this report and search.</div>:null}</div><footer><button onClick={()=>openDrilldown(drawer.key,Math.max(0,drawerOffset-50))} disabled={drawerOffset===0||isPending}><ChevronLeft size={15}/>Previous</button><span>{drawerOffset+1}–{drawerOffset+drawer.data.results.length}</span><button onClick={()=>openDrilldown(drawer.key,drawerOffset+50)} disabled={!drawer.data.hasMore||isPending}>Next<ChevronRight size={15}/></button></footer></aside></div>:null}
  </main>;
}
