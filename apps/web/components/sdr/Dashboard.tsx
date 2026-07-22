'use client';

import { useMemo, useState, useTransition, type FormEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Filter,
  Gauge,
  ListTodo,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  Target,
  UsersRound,
  type LucideIcon
} from 'lucide-react';

import { PriorityDrawer } from './PriorityDrawer';
import type {
  DashboardPayload,
  OwnerActivityDatum,
  PriorityDrilldown,
  WorkspaceState
} from './types';
import {
  ActivityExecutionChart,
  compactNumber,
  ConversionFunnelChart,
  formatNumber,
  humanize,
  KpiCard,
  LeadStatusBars,
  OwnerLeaderboardChart,
  Section
} from './WidgetKit';

type Tab = 'overview' | 'sources' | 'activities' | 'quality' | 'companies' | 'pipeline';

type KpiDefinition = {
  label: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  tone: 'green' | 'blue' | 'teal' | 'amber' | 'red' | 'purple';
  formattedValue?: string;
  onClick?: () => void;
};

const tabs: Array<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'sources', label: 'Lead Sources', icon: Target },
  { id: 'activities', label: 'Activities', icon: Activity },
  { id: 'quality', label: 'Data Quality', icon: ShieldCheck },
  { id: 'companies', label: 'Companies & ATS', icon: Building2 },
  { id: 'pipeline', label: 'Pipeline', icon: BriefcaseBusiness }
];

function metricValue(payload: DashboardPayload | null, key: string) {
  const metric = payload?.dashboard?.metrics?.[key];
  return metric?.status === 'ready' ? Number(metric.value ?? 0) : 0;
}

function initials(name: string | undefined) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function dateTime(value?: string | null) {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not synced yet';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(date);
}

function timeAgo(value?: string | null) {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not synced yet';
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function percent(value: number) {
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}

function AlertRow({
  icon: Icon,
  tone,
  title,
  detail,
  value,
  onClick
}: {
  icon: LucideIcon;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'purple';
  title: string;
  detail: string;
  value: number;
  onClick?: () => void;
}) {
  const Component = onClick ? 'button' : 'article';
  return (
    <Component className={`sdr-alert-row sdr-alert-${tone}`} onClick={onClick}>
      <span><Icon size={17} /></span>
      <div><strong>{title}</strong><small>{detail}</small></div>
      <b>{formatNumber(value)}</b>
      {onClick ? <ChevronRight size={16} /> : null}
    </Component>
  );
}

function FocusMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'teal';
  onClick?: () => void;
}) {
  const Component = onClick ? 'button' : 'article';
  return (
    <Component className={`sdr-focus-metric sdr-focus-${tone}`} onClick={onClick}>
      <span><Icon size={16} /></span>
      <div><strong>{value}</strong><h3>{label}</h3><p>{detail}</p></div>
    </Component>
  );
}

export function Dashboard() {
  const [accessKey, setAccessKey] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [drilldown, setDrilldown] = useState<PriorityDrilldown | null>(null);
  const [drillOffset, setDrillOffset] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitle, setDrawerTitle] = useState('Priority leads needing attention');
  const [drawerDescription, setDrawerDescription] = useState('Live HubSpot contacts behind the selected execution signal.');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const selectedWorkspaceState = useMemo(
    () => workspaces.find((item) => item.workspace?.id === selectedId) ?? null,
    [workspaces, selectedId]
  );
  const selectedWorkspace = selectedWorkspaceState?.workspace ?? null;
  const dashboard = payload?.dashboard;
  const operations = dashboard?.operationalSnapshot ?? {};
  const leaderboard = dashboard?.leaderboards?.activityByOwner?.value ?? [];
  const activityTrend = dashboard?.activityTrend ?? [];
  const conversionFunnel = dashboard?.conversionFunnel ?? [];
  const leadStatus = dashboard?.leadStatus ?? [];

  function requestHeaders() {
    return { 'x-operations-key': accessKey };
  }

  async function loadDashboard(workspaceId: string) {
    const response = await fetch(`/api/dashboard/${workspaceId}`, { headers: requestHeaders(), cache: 'no-store' });
    const result = await response.json() as DashboardPayload & { message?: string };
    if (!response.ok) throw new Error(result.message ?? 'Unable to load dashboard.');
    setPayload(result);
  }

  async function loadDrilldown(workspaceId: string, offset = 0) {
    const response = await fetch(`/api/dashboard/${workspaceId}/drilldown?limit=50&offset=${offset}`, {
      headers: requestHeaders(),
      cache: 'no-store'
    });
    const result = await response.json() as { drilldown?: PriorityDrilldown; message?: string };
    if (!response.ok || !result.drilldown) throw new Error(result.message ?? 'Unable to load lead details.');
    setDrilldown(result.drilldown);
    setDrillOffset(offset);
  }

  async function loadWorkspace(workspaceId: string, offset = 0) {
    await Promise.all([loadDashboard(workspaceId), loadDrilldown(workspaceId, offset)]);
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/operations/workspaces', { headers: requestHeaders(), cache: 'no-store' });
        const result = await response.json() as { results?: WorkspaceState[]; message?: string };
        if (!response.ok) throw new Error(result.message ?? 'Unable to open dashboard.');
        const rows = result.results ?? [];
        const workspaceId = rows[0]?.workspace?.id ?? '';
        setWorkspaces(rows);
        setSelectedId(workspaceId);
        setAuthorized(true);
        if (workspaceId) await loadWorkspace(workspaceId);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to open dashboard.');
      }
    });
  }

  function selectWorkspace(workspaceId: string) {
    setSelectedId(workspaceId);
    setPayload(null);
    setDrilldown(null);
    setMessage('');
    startTransition(() => loadWorkspace(workspaceId).catch((error) => setMessage(error.message)));
  }

  function refreshDashboard() {
    if (!selectedId) return;
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/operations/workspaces', { headers: requestHeaders(), cache: 'no-store' });
        const result = await response.json() as { results?: WorkspaceState[]; message?: string };
        if (!response.ok) throw new Error(result.message ?? 'Unable to refresh workspace status.');
        setWorkspaces(result.results ?? []);
        await loadWorkspace(selectedId, drillOffset);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to refresh dashboard.');
      }
    });
  }

  function openPriorityDrawer(title: string, description: string) {
    setDrawerTitle(title);
    setDrawerDescription(description);
    setDrawerOpen(true);
  }

  function changeDrillPage(nextOffset: number) {
    if (!selectedId || nextOffset < 0) return;
    setMessage('');
    startTransition(() => loadDrilldown(selectedId, nextOffset).catch((error) => setMessage(error.message)));
  }

  function navigate(tab: Tab) {
    setActiveTab(tab);
    document.getElementById(tab)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!authorized) {
    return (
      <main className="sdr-access-page">
        <section className="sdr-access-card">
          <div className="sdr-access-brand"><span>OI</span><div><strong>Ops Intelligence</strong><small>HubSpot command center</small></div></div>
          <span className="sdr-eyebrow">SECURE WORKSPACE ACCESS</span>
          <h1>Open your live<br />revenue workspace.</h1>
          <p>Use the protected workspace key to load tenant-isolated HubSpot reporting and operational intelligence.</p>
          <form onSubmit={unlock}>
            <input type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Workspace access key" autoComplete="current-password" required />
            <button disabled={isPending}>{isPending ? 'Opening workspace…' : 'Open dashboard'}</button>
          </form>
          <div className="sdr-access-trust"><span>Encrypted access</span><span>Tenant isolated</span><span>Live HubSpot data</span></div>
          {message ? <div className="sdr-error-banner">{message}</div> : null}
        </section>
      </main>
    );
  }

  if (!selectedWorkspace) return <main className="sdr-empty-page">No connected workspaces are available.</main>;

  const totalContacts = metricValue(payload, 'total_contacts');
  const priorityLeads = metricValue(payload, 'high_priority_contacts');
  const calls = metricValue(payload, 'calls_last_30_days');
  const meetings = metricValue(payload, 'meetings_last_30_days');
  const untouched = metricValue(payload, 'untouched_contacts');
  const stale = metricValue(payload, 'stale_contacts');
  const contactsNeedingAction = metricValue(payload, 'contacts_needing_action');
  const dealsAtRisk = metricValue(payload, 'deals_at_risk');
  const openPipeline = metricValue(payload, 'open_pipeline');
  const meetingRate = calls > 0 ? (meetings / calls) * 100 : 0;

  const requiredMappings = dashboard?.mappingReadiness?.required ?? [];
  const optionalMappings = dashboard?.mappingReadiness?.optional ?? [];
  const allMappings = [...requiredMappings, ...optionalMappings];
  const mappedCount = allMappings.filter((item) => item.approved).length;
  const mappingScore = allMappings.length ? Math.round((mappedCount / allMappings.length) * 100) : 100;

  const recordCounts = Object.fromEntries(
    (selectedWorkspaceState?.recordCounts ?? []).map((item) => [item.object_type, Number(item.count ?? 0)])
  );
  const syncTime = selectedWorkspaceState?.freshness?.newest_record_sync ?? dashboard?.freshness?.latestSync;
  const syncHealthy = Boolean(syncTime) && Date.now() - new Date(syncTime as string).getTime() < 24 * 60 * 60 * 1000;
  const portalId = selectedWorkspace.portal_id;
  const primaryOwner = leaderboard.find((item) => item.key !== 'Unassigned')?.owner ?? leaderboard[0]?.owner;

  const kpis: KpiDefinition[] = [
    { label: 'SDR portfolio', value: totalContacts, helper: `${formatNumber(contactsNeedingAction)} need attention`, icon: UsersRound, tone: 'green', onClick: () => openPriorityDrawer('Contacts needing attention', 'Unique untouched or stale contacts in this workspace.') },
    { label: 'Companies', value: Number(operations.totalCompanies ?? recordCounts.companies ?? 0), helper: 'Synced HubSpot accounts', icon: Building2, tone: 'blue' },
    { label: 'Calls', value: calls, helper: 'Last 30 days', icon: Phone, tone: 'teal' },
    { label: 'Meetings', value: meetings, helper: `${percent(meetingRate)} per call`, icon: CalendarDays, tone: 'amber' },
    { label: 'Open tasks', value: Number(operations.openTasks ?? 0), helper: `${formatNumber(operations.tasksDueToday ?? 0)} due today`, icon: CheckCircle2, tone: Number(operations.overdueTasks ?? 0) > 0 ? 'red' : 'blue' },
    { label: 'Meeting rate', value: meetingRate, helper: 'Calls converted to meetings', icon: Mail, tone: 'purple', formattedValue: percent(meetingRate) },
    { label: 'Open deals', value: Number(operations.openDeals ?? 0), helper: `${formatNumber(dealsAtRisk)} currently at risk`, icon: BriefcaseBusiness, tone: 'green' },
    { label: 'Open pipeline', value: openPipeline, helper: 'Portal currency', icon: CircleDollarSign, tone: 'amber', formattedValue: compactNumber(openPipeline) }
  ];

  const alerts = [
    { icon: Clock3, tone: 'amber' as const, title: 'Tasks due today', detail: 'Open work scheduled for the current day.', value: Number(operations.tasksDueToday ?? 0) },
    { icon: AlertTriangle, tone: 'red' as const, title: 'High-priority open tasks', detail: 'Priority activities still waiting for action.', value: Number(operations.highPriorityTasks ?? 0) },
    { icon: AlertTriangle, tone: 'red' as const, title: 'Overdue tasks', detail: 'Open tasks with a due date in the past.', value: Number(operations.overdueTasks ?? 0) },
    { icon: BriefcaseBusiness, tone: 'amber' as const, title: 'Deals with no next activity', detail: 'Open opportunities without a planned next step.', value: Number(operations.noNextActivity ?? 0) },
    { icon: UsersRound, tone: 'blue' as const, title: 'Untouched contacts', detail: 'Contacts older than two days with no outreach.', value: untouched, onClick: () => openPriorityDrawer('Untouched contacts', 'Contacts older than two days without recorded outreach.') },
    { icon: Target, tone: 'purple' as const, title: 'Contacts needing attention', detail: 'Unique untouched or stale contacts.', value: contactsNeedingAction, onClick: () => openPriorityDrawer('Contacts needing attention', 'Unique records behind the execution attention metric.') }
  ];

  return (
    <main className="sdr-app-shell">
      <header className="sdr-topbar">
        <div className="sdr-top-title"><strong>SDR Command Center</strong><span>Live HubSpot performance & attribution</span></div>
        <div className="sdr-top-actions">
          <span className={`sdr-status-pill ${syncHealthy ? '' : 'review'}`}><i />{syncHealthy ? 'LIVE · HUBSPOT' : 'SYNC REVIEW'}</span>
          <button className="sdr-icon-button" onClick={() => setFiltersOpen((current) => !current)} aria-label="Dashboard controls"><Filter size={16} /></button>
          <button className="sdr-refresh-button" onClick={refreshDashboard} disabled={isPending}><RefreshCw size={15} className={isPending ? 'sdr-spin' : ''} />{isPending ? 'Refreshing…' : 'Refresh data'}</button>
        </div>
      </header>

      <div className="sdr-workspace">
        <aside className="sdr-sidebar">
          <div className="sdr-brand"><div className="sdr-brand-mark">{initials(selectedWorkspace.name).slice(0, 1)}</div><div><strong>{selectedWorkspace.name}</strong><span>SDR Intelligence</span></div></div>
          <span className="sdr-nav-label">MAIN</span>
          <nav>
            {tabs.map(({ id, label, icon: Icon }) => (
              <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={15} /><span>{label}</span>{activeTab === id ? <ChevronRight size={14} /> : null}</button>
            ))}
          </nav>
          <span className="sdr-nav-label sdr-owner-label">SDR OWNER</span>
          <div className="sdr-owner-card"><div className="sdr-avatar">{initials(primaryOwner?.name || 'Workspace')}</div><div><span>Reporting view</span><strong>{primaryOwner?.name || 'All SDR owners'}</strong></div><BadgeCheck size={17} /></div>
          <span className="sdr-nav-label">COMPANIES</span>
          <div className="sdr-workspace-list">
            {workspaces.map((item) => <button key={item.workspace.id} className={item.workspace.id === selectedId ? 'active' : ''} onClick={() => selectWorkspace(item.workspace.id)}><i>{initials(item.workspace.name)}</i><span>{item.workspace.name}</span><b /></button>)}
          </div>
          <div className="sdr-sync-card"><Database size={15} /><div><strong>Last sync</strong><span>{dateTime(syncTime)}</span></div></div>
        </aside>

        <section className="sdr-content">
          <section className="sdr-page-title" id="overview">
            <div><span className="sdr-eyebrow">{selectedWorkspace.name.toUpperCase()} · SDR PERFORMANCE</span><h1>Overview</h1><p>{shortDate(activityTrend[0]?.day)} – {shortDate(activityTrend.at(-1)?.day)} · Live workspace intelligence</p></div>
            <div className="sdr-page-actions"><button className="active"><ArrowUpRight size={14} />Analytics dashboard</button><button onClick={() => openPriorityDrawer('Priority workspace', 'Highest-priority contacts requiring immediate follow-up.')}><UsersRound size={14} />Priority workspace</button></div>
          </section>

          {filtersOpen ? <section className="sdr-control-panel"><div><strong>Reporting controls</strong><span>The current analytics API is calculated over a live 30-day activity window. Workspace and record-level filters remain tenant-scoped.</span></div><div><span>Workspace</span><b>{selectedWorkspace.name}</b></div><div><span>Window</span><b>Last 30 days</b></div><div><span>Freshness</span><b>{timeAgo(syncTime)}</b></div></section> : null}
          {message ? <div className="sdr-error-banner">{message}</div> : null}

          <section className="sdr-kpi-grid">
            {kpis.map((item) => <KpiCard key={item.label} {...item} />)}
          </section>

          <section className="sdr-execution-focus">
            <div className="sdr-panel-heading"><div><span className="sdr-eyebrow">TODAY&apos;S EXECUTION FOCUS</span><h2>What needs attention now</h2></div><button onClick={() => openPriorityDrawer('Priority workspace', 'Attention-first contacts ready for follow-up.')}><Target size={14} />Focus & action</button></div>
            <div className="sdr-focus-grid">
              <FocusMetric icon={UsersRound} label="Untouched over 2 days" value={formatNumber(untouched)} detail="No recorded outreach" tone="red" onClick={() => openPriorityDrawer('Untouched contacts', 'Contacts older than two days without recorded outreach.')} />
              <FocusMetric icon={BriefcaseBusiness} label="No next activity" value={formatNumber(operations.noNextActivity ?? 0)} detail="Open deals without a next step" tone="amber" />
              <FocusMetric icon={ListTodo} label="Tasks due today" value={formatNumber(operations.tasksDueToday ?? 0)} detail="Open work due now" tone="green" />
              <FocusMetric icon={AlertTriangle} label="High-priority tasks" value={formatNumber(operations.highPriorityTasks ?? 0)} detail="Priority activity queue" tone="purple" />
              <FocusMetric icon={ArrowUpRight} label="Meeting conversion" value={percent(meetingRate)} detail="Calls converted to meetings" tone="blue" />
              <FocusMetric icon={UsersRound} label="Missing owner" value={formatNumber(operations.missingOwner ?? 0)} detail="Contacts without assignment" tone="teal" />
            </div>
          </section>

          <section className="sdr-two-column sdr-wide-left" id="activities">
            <Section title="Daily SDR execution" description="Calls, tasks and meetings across the last 21 days." action={<span className="sdr-drilldown-hint">Live activity</span>}>
              <ActivityExecutionChart rows={activityTrend} />
            </Section>
            <Section title="SDR conversion funnel" description="CRM contacts progressing into activities and revenue outcomes." action={<span className="sdr-drilldown-hint">Live funnel</span>}>
              <ConversionFunnelChart rows={conversionFunnel} onSelect={(datum) => datum.key.toLowerCase().includes('contact') ? openPriorityDrawer(datum.label, 'Contacts represented by this conversion stage.') : undefined} />
            </Section>
          </section>

          <section className="sdr-two-column sdr-alerts-layout">
            <Section title="Operational alerts" description="Actionable conditions detected from synchronized HubSpot records.">
              <div className="sdr-alert-list">{alerts.map((item) => <AlertRow key={item.title} {...item} />)}</div>
            </Section>
            <Section title="Lead status" description="HubSpot lead-status distribution across synchronized contacts." action={<span className="sdr-drilldown-hint">{compactNumber(totalContacts)} contacts</span>}>
              <LeadStatusBars rows={leadStatus} onSelect={() => openPriorityDrawer('Lead-status contacts needing attention', 'Priority contacts within the current lead-status distribution.')} />
            </Section>
          </section>

          <section className="sdr-two-column" id="sources">
            <Section title="Activity by owner" description="Calls attributed to HubSpot owners during the current reporting window.">
              <OwnerLeaderboardChart rows={leaderboard} />
            </Section>
            <Section title="CRM footprint" description="Synchronized object coverage available to the analytics engine.">
              <div className="sdr-record-grid">
                {['contacts', 'companies', 'deals', 'calls', 'meetings', 'tasks'].map((objectType) => <article key={objectType}><span>{humanize(objectType)}</span><strong>{compactNumber(recordCounts[objectType] ?? 0)}</strong><small>Live records</small></article>)}
              </div>
            </Section>
          </section>

          <section className="sdr-quality-panel" id="quality">
            <div><span>CRM intelligence coverage</span><strong>{mappingScore}%</strong><small>{mappedCount} of {allMappings.length} semantic fields configured</small></div>
            <div className="sdr-quality-progress"><i style={{ width: `${mappingScore}%` }} /></div>
            <div><span>Data freshness</span><strong>{timeAgo(syncTime)}</strong><small>{selectedWorkspaceState?.latestRun?.status || 'Sync not started'}</small></div>
            <div id="pipeline"><span>Pipeline exposure</span><strong>{compactNumber(openPipeline)}</strong><small>{formatNumber(dealsAtRisk)} deals at risk</small></div>
          </section>

          <section className="sdr-priority-panel" id="companies">
            <div className="sdr-panel-heading">
              <div><h2>Priority leads</h2><p>{drilldown?.fallback ? 'Attention-first fallback while lead-quality mapping is configured.' : 'Highest-priority contacts requiring immediate follow-up.'}</p></div>
              <div className="sdr-table-actions"><button onClick={() => changeDrillPage(Math.max(0, drillOffset - 50))} disabled={isPending || drillOffset === 0}>Previous</button><span>Rows {drillOffset + 1}–{drillOffset + (drilldown?.results.length ?? 0)}</span><button onClick={() => changeDrillPage(drillOffset + 50)} disabled={isPending || !drilldown?.hasMore}>Next</button></div>
            </div>
            <div className="sdr-priority-table">
              <div className="sdr-priority-header"><span>Priority</span><span>Contact</span><span>Company</span><span>Country</span><span>Owner</span><span>Lead status</span><span>Phone</span></div>
              {(drilldown?.results ?? []).map((row, index) => {
                const properties = row.properties ?? {};
                const name = [properties.firstname, properties.lastname].filter(Boolean).join(' ') || `Contact ${row.id}`;
                const owner = leaderboard.find((item: OwnerActivityDatum) => String(item.owner?.id) === String(properties.hubspot_owner_id))?.owner;
                const hubspotUrl = portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${row.id}` : null;
                return <article key={row.id}><span className="sdr-priority-number">{String(drillOffset + index + 1).padStart(2, '0')}</span><span className="sdr-contact-cell">{hubspotUrl ? <a href={hubspotUrl} target="_blank" rel="noreferrer">{name}</a> : <strong>{name}</strong>}<small>{properties.jobtitle || properties.email || `HubSpot ID ${row.id}`}</small></span><span>{properties.company || '—'}</span><span>{properties.country || '—'}</span><span>{owner?.name || properties.hubspot_owner_id || 'Unassigned'}</span><span><i>{humanize(properties.hs_lead_status || properties.lifecyclestage)}</i></span><span>{properties.phone || properties.mobilephone || '—'}</span></article>;
              })}
              {!drilldown?.results.length ? <div className="sdr-table-empty">No contacts currently match the priority workspace.</div> : null}
            </div>
          </section>
        </section>
      </div>

      {drawerOpen && drilldown ? <PriorityDrawer drilldown={drilldown} portalId={portalId} owners={leaderboard} title={drawerTitle} description={drawerDescription} onClose={() => setDrawerOpen(false)} /> : null}
    </main>
  );
}
