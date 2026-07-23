'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BadgeDollarSign,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  DatabaseZap,
  ExternalLink,
  Filter,
  Gauge,
  ListTodo,
  LoaderCircle,
  PhoneCall,
  ShieldCheck,
  Target,
  UserRoundCheck,
  UsersRound,
  X,
  type LucideIcon
} from 'lucide-react';

import './agreed-reports.css';

type Filters = {
  from: string;
  to: string;
  ownerId?: string | null;
  country?: string | null;
  pipelineId?: string | null;
  stageId?: string | null;
  leadSource?: string | null;
};

type MappingStatus = {
  status: 'ready' | 'configuration_required';
  objectType?: string | null;
  propertyName?: string | null;
};

type Execution = {
  calls: number;
  connectedCalls: number;
  connectionRate: number;
  meetingsBooked: number;
  meetingsCompleted: number;
  meetingCompletionRate: number;
  noShowMeetings: number;
  noShowRate: number;
  tasks: number;
  completedTasks: number;
  taskCompletionRate: number;
  openTasks?: number;
  tasksDueToday?: number;
  overdueTasks?: number;
  portfolioContacts?: number;
  newContacts?: number;
  contactedContacts?: number;
  leadContactRate?: number;
  untouchedContacts?: number;
  coldContacts?: number;
  missingOwnerContacts?: number;
};

type QualityRow = {
  quality: string;
  contacts: number;
  contacted: number;
  contactRate: number;
  meetingsCompleted: number;
  opportunities: number;
  won: number;
  needsContact: number;
};

type OperatingReports = {
  definitionsVersion: string;
  mappings: Record<string, MappingStatus>;
  todayFocus: {
    priorityNeedsContact: number;
    untouchedContacts: number;
    coldContacts: number;
    overdueTasks: number;
    tasksDueToday: number;
    dealsAtRisk: number;
    overdueCloseDeals: number;
  };
  execution: Execution;
  yesterday: Execution;
  qualityFunnel: {
    status: 'ready' | 'configuration_required';
    mapping: MappingStatus;
    rows: QualityRow[];
    countryCoverage: Array<{ country: string; quality: string; contacts: number }>;
    priorityNeedsContact: number;
    message?: string | null;
  };
  revenueHealth: {
    openDeals: number;
    openPipeline: number;
    dealsAtRisk: number;
    atRiskPipeline: number;
    overdueCloseDeals: number;
    overdueClosePipeline: number;
    closingSoonDeals: number;
    closingSoonPipeline: number;
    wonDeals: number;
    wonRevenue: number;
    commercialMilestones: {
      signedContract: { deals: number; value: number; confidence: string };
      booked: { deals: number; value: number; confidence: string };
      cashing: { deals: number; value: number; confidence: string };
    };
  };
  retention: {
    status: 'ready' | 'configuration_required';
    sourceMode: string;
    missingMappings: string[];
    mappings: Record<string, MappingStatus>;
    metrics: null | {
      upcoming: number;
      delayed: number;
      renewedLate: number;
      lost: number;
      booked: number;
      cashCollected: number;
      renewalValue: number;
      remainingCollection: number;
      notInBudget: number;
    };
    productBreakdown: Array<{ product: string; accounts: number; renewalValue: number }>;
    message: string;
  };
};

export type AgreedReportSnapshot = {
  workspaceId: string;
  report: {
    filters: Filters & { days?: number };
    operatingReports?: OperatingReports;
  };
};

type DrilldownRow = {
  id: string;
  properties: Record<string, string | undefined>;
  syncedAt?: string | null;
};

type Drilldown = {
  key: string;
  objectType: string;
  limit: number;
  offset: number;
  hasMore: boolean;
  results: DrilldownRow[];
};

type MetricCard = {
  label: string;
  value: number;
  helper: string;
  icon: LucideIcon;
  drilldown?: string;
  amount?: boolean;
  percent?: boolean;
  tone?: 'default' | 'good' | 'warning' | 'critical' | 'accent';
};

const HUBSPOT_OBJECT_TYPE_IDS: Record<string, string> = {
  calls: '0-48',
  companies: '0-2',
  contacts: '0-1',
  deals: '0-3',
  meetings: '0-47',
  tasks: '0-27',
  tickets: '0-5'
};

function integer(value: unknown) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(value ?? 0));
}

function compactCurrency(value: unknown) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
    style: 'currency',
    currency: 'USD'
  }).format(Number(value ?? 0));
}

function percentage(value: unknown) {
  return `${Number(value ?? 0).toFixed(1)}%`;
}

function titleCase(value: unknown) {
  return String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hubSpotRecordUrl(portalId: string | null, objectType: string, recordId: string) {
  if (!portalId) return null;
  const type = objectType.toLowerCase().endsWith('s') ? objectType.toLowerCase() : `${objectType.toLowerCase()}s`;
  const base = `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}`;
  const id = encodeURIComponent(recordId);
  if (type === 'contacts') return `${base}/contact/${id}`;
  if (type === 'companies') return `${base}/company/${id}`;
  if (type === 'deals') return `${base}/deal/${id}`;
  const objectTypeId = HUBSPOT_OBJECT_TYPE_IDS[type];
  return objectTypeId ? `${base}/record/${objectTypeId}/${id}` : null;
}

function queryString(filters: Filters, offset = 0) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (String(value ?? '').trim()) params.set(key, String(value));
  }
  params.set('limit', '50');
  params.set('offset', String(offset));
  return params.toString();
}

function usePortalTarget(selector: string) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const findTarget = () => setTarget(document.querySelector<HTMLElement>(selector));
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);
  return target;
}

function MetricButton({ card, onOpen }: { card: MetricCard; onOpen: (key: string, title: string) => void }) {
  const Icon = card.icon;
  const value = card.percent ? percentage(card.value) : card.amount ? compactCurrency(card.value) : integer(card.value);
  const content = (
    <>
      <span className="arr-metric-icon"><Icon size={18} /></span>
      <div><strong>{value}</strong><h4>{card.label}</h4><p>{card.helper}</p></div>
      {card.drilldown ? <ArrowUpRight size={15} className="arr-metric-arrow" /> : null}
    </>
  );
  return card.drilldown ? (
    <button type="button" className={`arr-metric arr-tone-${card.tone ?? 'default'}`} onClick={() => onOpen(card.drilldown!, card.label)}>
      {content}
    </button>
  ) : (
    <article className={`arr-metric arr-tone-${card.tone ?? 'default'}`}>{content}</article>
  );
}

function RecordLabel({ row }: { row: DrilldownRow }) {
  const properties = row.properties || {};
  if (properties.firstname || properties.lastname) {
    return <><strong>{[properties.firstname, properties.lastname].filter(Boolean).join(' ')}</strong><small>{properties.email || properties.company || `HubSpot ID ${row.id}`}</small></>;
  }
  if (properties.dealname) {
    return <><strong>{properties.dealname}</strong><small>{properties.amount ? `Amount ${properties.amount}` : `HubSpot ID ${row.id}`}</small></>;
  }
  return <><strong>{properties.hs_task_subject || properties.hs_call_title || properties.hs_meeting_title || `Record ${row.id}`}</strong><small>{properties.hs_task_status || properties.hs_call_status || properties.hs_meeting_outcome || 'CRM record'}</small></>;
}

export function AgreedReportsPanel({ snapshot, portalId }: { snapshot: AgreedReportSnapshot | null; portalId: string | null }) {
  const target = usePortalTarget('.ric-content');
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [drillTitle, setDrillTitle] = useState('Report details');
  const [drillKey, setDrillKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const operating = snapshot?.report.operatingReports;

  const focusCards = useMemo<MetricCard[]>(() => operating ? [
    { label: 'Priority leads to contact', value: operating.todayFocus.priorityNeedsContact, helper: 'Rank A/B or equivalent, untouched for 2+ days', icon: Target, drilldown: 'priority-needs-contact', tone: 'critical' },
    { label: 'Untouched contacts', value: operating.todayFocus.untouchedContacts, helper: 'No recorded outreach after two days', icon: UsersRound, drilldown: 'untouched-contacts', tone: 'warning' },
    { label: 'Cold contacts', value: operating.todayFocus.coldContacts, helper: 'No contact for at least 21 days', icon: Clock3, drilldown: 'cold-contacts', tone: 'warning' },
    { label: 'Tasks due today', value: operating.todayFocus.tasksDueToday, helper: 'Open actions requiring completion today', icon: ListTodo, drilldown: 'tasks-due-today', tone: 'accent' },
    { label: 'Overdue tasks', value: operating.todayFocus.overdueTasks, helper: 'Open actions past their due date', icon: AlertTriangle, drilldown: 'overdue-tasks', tone: 'critical' },
    { label: 'Deals at risk', value: operating.todayFocus.dealsAtRisk, helper: 'No next action or an overdue close date', icon: BriefcaseBusiness, drilldown: 'deals-at-risk', tone: 'critical' }
  ] : [], [operating]);

  const executionCards = useMemo<MetricCard[]>(() => operating ? [
    { label: 'Calls', value: operating.execution.calls, helper: 'Calls in the selected reporting window', icon: PhoneCall, drilldown: 'calls' },
    { label: 'Connected calls', value: operating.execution.connectedCalls, helper: 'Mapped connected/answered outcomes', icon: UserRoundCheck, drilldown: 'connected-calls', tone: 'good' },
    { label: 'Connection rate', value: operating.execution.connectionRate, helper: 'Connected calls divided by total calls', icon: Gauge, percent: true, tone: 'accent' },
    { label: 'Meetings booked', value: operating.execution.meetingsBooked, helper: 'Meeting records in the selected window', icon: CalendarClock, drilldown: 'meetings' },
    { label: 'Meetings completed', value: operating.execution.meetingsCompleted, helper: 'Mapped completed or attended outcomes', icon: CalendarCheck2, drilldown: 'completed-meetings', tone: 'good' },
    { label: 'No-show rate', value: operating.execution.noShowRate, helper: `${integer(operating.execution.noShowMeetings)} no-show meetings`, icon: AlertTriangle, drilldown: 'no-show-meetings', percent: true, tone: operating.execution.noShowRate > 20 ? 'critical' : 'warning' },
    { label: 'Lead contact rate', value: operating.execution.leadContactRate ?? 0, helper: `${integer(operating.execution.contactedContacts)} contacted contacts`, icon: Target, percent: true, tone: 'accent' },
    { label: 'Completed tasks', value: operating.execution.completedTasks, helper: `${percentage(operating.execution.taskCompletionRate)} completion rate`, icon: CheckCircle2, drilldown: 'completed-tasks', tone: 'good' }
  ] : [], [operating]);

  const yesterdayCards = useMemo<MetricCard[]>(() => operating ? [
    { label: 'Calls yesterday', value: operating.yesterday.calls, helper: `${percentage(operating.yesterday.connectionRate)} connected`, icon: PhoneCall },
    { label: 'Connected yesterday', value: operating.yesterday.connectedCalls, helper: 'Connected call outcomes', icon: UserRoundCheck, tone: 'good' },
    { label: 'Meetings yesterday', value: operating.yesterday.meetingsBooked, helper: `${integer(operating.yesterday.meetingsCompleted)} completed`, icon: CalendarCheck2 },
    { label: 'Tasks yesterday', value: operating.yesterday.completedTasks, helper: `${percentage(operating.yesterday.taskCompletionRate)} completed`, icon: CheckCircle2 }
  ] : [], [operating]);

  const revenueCards = useMemo<MetricCard[]>(() => operating ? [
    { label: 'Open pipeline', value: operating.revenueHealth.openPipeline, helper: `${integer(operating.revenueHealth.openDeals)} open deals`, icon: CircleDollarSign, drilldown: 'open-deals', amount: true, tone: 'accent' },
    { label: 'Pipeline at risk', value: operating.revenueHealth.atRiskPipeline, helper: `${integer(operating.revenueHealth.dealsAtRisk)} deals need intervention`, icon: AlertTriangle, drilldown: 'deals-at-risk', amount: true, tone: 'critical' },
    { label: 'Closing in 14 days', value: operating.revenueHealth.closingSoonPipeline, helper: `${integer(operating.revenueHealth.closingSoonDeals)} deals`, icon: CalendarClock, drilldown: 'closing-soon-deals', amount: true, tone: 'warning' },
    { label: 'Won revenue', value: operating.revenueHealth.wonRevenue, helper: `${integer(operating.revenueHealth.wonDeals)} won deals`, icon: BadgeDollarSign, drilldown: 'won-deals', amount: true, tone: 'good' }
  ] : [], [operating]);

  async function openDrilldown(key: string, title: string, offset = 0) {
    if (!snapshot) return;
    setLoading(true);
    setError('');
    setDrillKey(key);
    setDrillTitle(title);
    try {
      const response = await fetch(`/api/dashboard/${encodeURIComponent(snapshot.workspaceId)}/reports/${encodeURIComponent(key)}?${queryString(snapshot.report.filters, offset)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.drilldown) throw new Error(payload.message || 'Unable to load report records.');
      setDrilldown(payload.drilldown as Drilldown);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load report records.');
    } finally {
      setLoading(false);
    }
  }

  if (!target || !snapshot || !operating) return null;

  const content = (
    <section className="arr-shell" aria-label="Agreed operating reports">
      <header className="arr-header">
        <div>
          <span><DatabaseZap size={15} /> AGREED REPORT DEFINITIONS · {operating.definitionsVersion}</span>
          <h2>Operational reports built for action.</h2>
          <p>Connected calls, meeting outcomes, priority lead coverage, revenue risk and retention use approved HubSpot mappings where available.</p>
        </div>
        <div className="arr-mapping-state">
          <ShieldCheck size={18} />
          <div><strong>{Object.values(operating.mappings).filter((mapping) => mapping.status === 'ready').length}/4 core mappings ready</strong><span>Missing mappings are shown as configuration items, never guessed silently.</span></div>
        </div>
      </header>

      <section className="arr-section arr-role-manager arr-role-sdr" id="agreed-focus">
        <div className="arr-section-heading"><div><span>TODAY'S FOCUS</span><h3>Work the records that can change today.</h3></div><b><Filter size={14} />Current global filters applied</b></div>
        <div className="arr-metric-grid arr-focus-grid">{focusCards.map((card) => <MetricButton key={card.label} card={card} onOpen={openDrilldown} />)}</div>
      </section>

      <section className="arr-section arr-role-sdr" id="agreed-yesterday">
        <div className="arr-section-heading"><div><span>YESTERDAY'S PERFORMANCE</span><h3>One-day execution snapshot.</h3></div></div>
        <div className="arr-metric-grid arr-yesterday-grid">{yesterdayCards.map((card) => <MetricButton key={card.label} card={card} onOpen={openDrilldown} />)}</div>
      </section>

      <section className="arr-section arr-role-executive arr-role-manager arr-role-sdr" id="agreed-execution">
        <div className="arr-section-heading"><div><span>OUTREACH & CONVERSION</span><h3>Separate activity volume from real outcomes.</h3></div><b>{snapshot.report.filters.from} → {snapshot.report.filters.to}</b></div>
        <div className="arr-metric-grid">{executionCards.map((card) => <MetricButton key={card.label} card={card} onOpen={openDrilldown} />)}</div>
      </section>

      <section className="arr-section arr-role-executive arr-role-manager" id="agreed-revenue">
        <div className="arr-section-heading"><div><span>REVENUE HEALTH</span><h3>Pipeline exposure and commercial milestones.</h3></div></div>
        <div className="arr-metric-grid arr-revenue-grid">{revenueCards.map((card) => <MetricButton key={card.label} card={card} onOpen={openDrilldown} />)}</div>
        <div className="arr-milestones">
          {([
            ['Signed contract', operating.revenueHealth.commercialMilestones.signedContract, 'signed-contract-deals'],
            ['Booked', operating.revenueHealth.commercialMilestones.booked, 'booked-deals'],
            ['Cashing / collected', operating.revenueHealth.commercialMilestones.cashing, 'cashing-deals']
          ] as const).map(([label, milestone, key]) => (
            <button key={label} type="button" onClick={() => openDrilldown(key, label)}>
              <span>{label}</span><strong>{compactCurrency(milestone.value)}</strong><small>{integer(milestone.deals)} deals · stage-label inferred</small><ExternalLink size={14} />
            </button>
          ))}
        </div>
      </section>

      <section className="arr-section arr-role-manager arr-role-sdr arr-role-revops" id="agreed-quality">
        <div className="arr-section-heading"><div><span>RANK / TIER FUNNEL</span><h3>Coverage and conversion by approved lead quality.</h3></div></div>
        {operating.qualityFunnel.status === 'ready' ? (
          <div className="arr-quality-table">
            <div className="arr-quality-head"><span>Quality</span><span>Contacts</span><span>Contacted</span><span>Contact rate</span><span>Completed meetings</span><span>Opportunities</span><span>Won</span><span>Needs contact</span></div>
            {operating.qualityFunnel.rows.map((row) => (
              <article key={row.quality}>
                <span><i data-quality={row.quality} /> <strong>{titleCase(row.quality)}</strong></span>
                <b>{integer(row.contacts)}</b><b>{integer(row.contacted)}</b><b>{percentage(row.contactRate)}</b><b>{integer(row.meetingsCompleted)}</b><b>{integer(row.opportunities)}</b><b>{integer(row.won)}</b><b className={row.needsContact ? 'attention' : ''}>{integer(row.needsContact)}</b>
              </article>
            ))}
            {operating.qualityFunnel.rows.length === 0 ? <div className="arr-empty">No quality records match the current filters.</div> : null}
          </div>
        ) : (
          <div className="arr-configuration"><DatabaseZap size={22} /><div><strong>Lead Quality mapping required</strong><p>{operating.qualityFunnel.message}</p></div><a href="/settings/mappings">Configure mapping <ArrowUpRight size={14} /></a></div>
        )}
      </section>

      <section className="arr-section arr-role-executive arr-role-revops" id="agreed-retention">
        <div className="arr-section-heading"><div><span>RETENTION & RENEWALS</span><h3>Upcoming, delayed, late and lost accounts.</h3></div><b>{operating.retention.sourceMode === 'hubspot_fallback' ? 'HubSpot fallback' : operating.retention.sourceMode}</b></div>
        {operating.retention.status === 'ready' && operating.retention.metrics ? (
          <>
            <div className="arr-metric-grid arr-retention-grid">
              <MetricButton card={{ label: 'Upcoming renewals', value: operating.retention.metrics.upcoming, helper: 'Current or future renewal month', icon: CalendarClock, drilldown: 'retention-upcoming', tone: 'accent' }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Delayed accounts', value: operating.retention.metrics.delayed, helper: 'Renewal month passed without renewal', icon: AlertTriangle, drilldown: 'retention-delayed', tone: 'critical' }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Renewed late', value: operating.retention.metrics.renewedLate, helper: 'Closed after the mapped renewal date', icon: Clock3, drilldown: 'retention-renewed-late', tone: 'warning' }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Lost accounts', value: operating.retention.metrics.lost, helper: 'Inactive, churned or closed lost', icon: AlertTriangle, drilldown: 'retention-lost', tone: 'critical' }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Renewal value', value: operating.retention.metrics.renewalValue, helper: 'Mapped renewal portfolio value', icon: CircleDollarSign, amount: true }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Remaining collection', value: operating.retention.metrics.remainingCollection, helper: 'Value not marked won/renewed', icon: BadgeDollarSign, amount: true, tone: 'warning' }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Cash collected', value: operating.retention.metrics.cashCollected, helper: `${integer(operating.retention.metrics.booked)} booked records`, icon: CheckCircle2, amount: true, tone: 'good' }} onOpen={openDrilldown} />
              <MetricButton card={{ label: 'Not in budget', value: operating.retention.metrics.notInBudget, helper: 'Records missing a renewal date', icon: DatabaseZap }} onOpen={openDrilldown} />
            </div>
            <p className="arr-retention-note">{operating.retention.message}</p>
          </>
        ) : (
          <div className="arr-configuration"><DatabaseZap size={22} /><div><strong>Retention mapping required</strong><p>{operating.retention.message}</p><small>Missing: {operating.retention.missingMappings.join(', ') || 'renewal_date:deals'}</small></div><a href="/settings/mappings">Configure retention <ArrowUpRight size={14} /></a></div>
        )}
      </section>
    </section>
  );

  const drawer = drilldown || loading || error ? (
    <div className="arr-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDrilldown(null)}>
      <aside className="arr-drawer" aria-label={`${drillTitle} records`}>
        <header><div><span>LIVE HUBSPOT RECORDS</span><h2>{drillTitle}</h2><p>Global report filters are applied to every record.</p></div><button type="button" onClick={() => { setDrilldown(null); setError(''); }} aria-label="Close report"><X size={19} /></button></header>
        {loading ? <div className="arr-drawer-state"><LoaderCircle className="arr-spin" size={24} />Loading records…</div> : null}
        {error ? <div className="arr-drawer-state error"><AlertTriangle size={22} /><strong>{error}</strong></div> : null}
        {!loading && !error && drilldown ? (
          <>
            <div className="arr-record-list">
              {drilldown.results.map((row) => {
                const properties = row.properties || {};
                const url = hubSpotRecordUrl(portalId, drilldown.objectType, row.id);
                return (
                  <article key={row.id}>
                    <span className="arr-record-main"><RecordLabel row={row} />{url ? <a href={url} target="_blank" rel="noreferrer">Open in HubSpot <ExternalLink size={12} /></a> : null}</span>
                    <span><strong>{properties.hubspot_owner_id || properties.hs_activity_assigned_to_user_id || 'Unassigned'}</strong><small>{titleCase(properties.hs_lead_status || properties.hs_task_status || properties.hs_call_status || properties.hs_meeting_outcome || properties.dealstage || 'Unknown')}</small></span>
                    <span><strong>{properties.company || properties.pipeline || '—'}</strong><small>{properties.country || properties.jobtitle || properties.hs_task_priority || '—'}</small></span>
                    <span><strong>{properties.notes_last_contacted || properties.hs_timestamp || properties.closedate || '—'}</strong><small>{row.syncedAt ? `Synced ${new Date(row.syncedAt).toLocaleDateString()}` : 'CRM record'}</small></span>
                  </article>
                );
              })}
              {drilldown.results.length === 0 ? <div className="arr-empty">No records match this report.</div> : null}
            </div>
            <footer><button type="button" onClick={() => openDrilldown(drillKey, drillTitle, Math.max(0, drilldown.offset - drilldown.limit))} disabled={drilldown.offset === 0}><ChevronLeft size={15} />Previous</button><span>{drilldown.offset + 1}–{drilldown.offset + drilldown.results.length}</span><button type="button" onClick={() => openDrilldown(drillKey, drillTitle, drilldown.offset + drilldown.limit)} disabled={!drilldown.hasMore}>Next<ChevronRight size={15} /></button></footer>
          </>
        ) : null}
      </aside>
    </div>
  ) : null;

  return <>{createPortal(content, target)}{drawer ? createPortal(drawer, document.body) : null}</>;
}
