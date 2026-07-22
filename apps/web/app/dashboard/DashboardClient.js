'use client';

import { useMemo, useState, useTransition } from 'react';

import styles from './page.module.css';

const KPI_KEYS = [
  'total_contacts',
  'high_priority_contacts',
  'calls_last_30_days',
  'meetings_last_30_days',
  'open_pipeline',
  'deals_at_risk',
  'untouched_contacts',
  'stale_contacts'
];

const KPI_META = {
  total_contacts: { label: 'Portfolio contacts', eyebrow: 'Reach', icon: '◎', tone: '#7c6cf2' },
  high_priority_contacts: { label: 'Priority leads', eyebrow: 'Intent', icon: '◆', tone: '#f472b6' },
  calls_last_30_days: { label: 'Calls', eyebrow: 'Last 30 days', icon: '↗', tone: '#38bdf8' },
  meetings_last_30_days: { label: 'Meetings', eyebrow: 'Last 30 days', icon: '◇', tone: '#34d399' },
  open_pipeline: { label: 'Open pipeline', eyebrow: 'Portal currency', icon: '◈', tone: '#a78bfa' },
  deals_at_risk: { label: 'Deals at risk', eyebrow: 'Needs action', icon: '!', tone: '#fb7185' },
  untouched_contacts: { label: 'Untouched leads', eyebrow: '2+ days', icon: '○', tone: '#fbbf24' },
  stale_contacts: { label: 'Stale leads', eyebrow: '21+ days', icon: '⌁', tone: '#fb923c' }
};

function number(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function compact(value) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0));
}

function date(value) {
  if (!value) return 'No data yet';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'No data yet'
    : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function timeAgo(value) {
  if (!value) return 'Not synced yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not synced yet';
  const minutes = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function initials(name) {
  return String(name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function metricValue(metrics, key) {
  const metric = metrics?.[key];
  return metric?.status === 'ready' ? Number(metric.value ?? 0) : 0;
}

function percentage(value) {
  return `${Math.max(0, Math.min(100, Number(value || 0))).toFixed(1)}%`;
}

function MetricCard({ metricKey, metric }) {
  const meta = KPI_META[metricKey];
  const ready = metric?.status === 'ready';
  const monetary = metricKey === 'open_pipeline';
  const displayValue = ready ? (monetary ? compact(metric.value) : number(metric.value)) : '—';

  return (
    <article className={`${styles.metricCard} ${!ready ? styles.metricMuted : ''}`} style={{ '--tone': meta.tone }}>
      <div className={styles.metricTop}>
        <span className={styles.metricIcon}>{meta.icon}</span>
        <span className={styles.metricEyebrow}>{meta.eyebrow}</span>
      </div>
      <strong>{displayValue}</strong>
      <div className={styles.metricBottom}>
        <span>{meta.label}</span>
        <small>{ready ? 'Live CRM data' : 'Mapping required'}</small>
      </div>
    </article>
  );
}

function RingChart({ value, label, detail }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className={styles.ringWrap}>
      <div className={styles.ring} style={{ '--progress': `${safeValue * 3.6}deg` }}>
        <div>
          <strong>{safeValue.toFixed(1)}%</strong>
          <span>{label}</span>
        </div>
      </div>
      <p>{detail}</p>
    </div>
  );
}

function MiniBars({ values }) {
  const max = Math.max(1, ...values.map((item) => Number(item.value || 0)));
  return (
    <div className={styles.miniBars} aria-label="CRM record volume">
      {values.map((item) => (
        <div key={item.label} title={`${item.label}: ${number(item.value)}`}>
          <i style={{ height: `${Math.max(8, (Number(item.value || 0) / max) * 100)}%` }} />
          <span>{item.short}</span>
        </div>
      ))}
    </div>
  );
}

function MotionFunnel({ rows }) {
  const max = Math.max(1, ...rows.map((item) => Number(item.value || 0)));
  return (
    <div className={styles.funnel}>
      {rows.map((item, index) => (
        <div key={item.label} className={styles.funnelRow}>
          <span className={styles.funnelIndex}>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <div className={styles.funnelLabels}>
              <strong>{item.label}</strong>
              <b>{compact(item.value)}</b>
            </div>
            <div className={styles.funnelTrack}>
              <i style={{ width: `${Math.max(4, (Number(item.value || 0) / max) * 100)}%`, '--bar-tone': item.tone }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardClient() {
  const [accessKey, setAccessKey] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [message, setMessage] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedWorkspaceState = useMemo(
    () => workspaces.find((item) => item.workspace?.id === selectedId) ?? null,
    [workspaces, selectedId]
  );
  const selectedWorkspace = selectedWorkspaceState?.workspace ?? null;
  const dashboard = payload?.dashboard;
  const metrics = dashboard?.metrics ?? {};

  function headers() {
    return { 'x-operations-key': accessKey };
  }

  async function loadDashboard(workspaceId) {
    const response = await fetch(`/api/dashboard/${workspaceId}`, { headers: headers(), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.message ?? 'Unable to load dashboard.');
    setPayload(result);
  }

  async function unlock(event) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/operations/workspaces', { headers: headers(), cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.message ?? 'Unable to open dashboard.');
        const rows = result.results ?? [];
        setWorkspaces(rows);
        const workspaceId = rows[0]?.workspace?.id ?? '';
        setSelectedId(workspaceId);
        setAuthorized(true);
        if (workspaceId) await loadDashboard(workspaceId);
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function changeWorkspace(workspaceId) {
    setSelectedId(workspaceId);
    setDrilldown(null);
    setMessage(null);
    startTransition(() => loadDashboard(workspaceId).catch((error) => setMessage(error.message)));
  }

  function refreshDashboard() {
    if (!selectedId) return;
    setMessage(null);
    startTransition(() => loadDashboard(selectedId).catch((error) => setMessage(error.message)));
  }

  function openDrilldown() {
    if (!selectedId) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/dashboard/${selectedId}/drilldown?limit=50&offset=0`, {
          headers: headers(),
          cache: 'no-store'
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.message ?? 'Unable to load lead details.');
        setDrilldown(result.drilldown);
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  if (!authorized) {
    return (
      <section className={styles.gate}>
        <div className={styles.gateGlow} />
        <div className={styles.gateMark}><span>O</span></div>
        <span className="eyebrow">REVENUE INTELLIGENCE CLOUD</span>
        <h1>One CRM.<br />Every answer.</h1>
        <p>Connect a company workspace and open a premium, tenant-scoped view of pipeline, activity, team execution and the next best action.</p>
        <form onSubmit={unlock}>
          <input
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            placeholder="Workspace access key"
            autoComplete="current-password"
            required
          />
          <button disabled={isPending}>{isPending ? 'Opening workspace…' : 'Enter command center'}</button>
        </form>
        <div className={styles.gateTrust}>
          <span>Encrypted access</span><span>Tenant isolated</span><span>Live HubSpot data</span>
        </div>
        {message && <div className={styles.error}>{message}</div>}
      </section>
    );
  }

  if (!selectedWorkspace) return <section className={styles.empty}>No connected workspaces are available.</section>;

  const leaderboard = dashboard?.leaderboards?.activityByOwner?.value ?? [];
  const maxOwner = Math.max(1, ...leaderboard.map((item) => Number(item.value ?? 0)));
  const requiredMappings = dashboard?.mappingReadiness?.required ?? [];
  const optionalMappings = dashboard?.mappingReadiness?.optional ?? [];
  const allMappings = [...requiredMappings, ...optionalMappings];
  const mappedCount = allMappings.filter((item) => item.approved).length;
  const mappingScore = allMappings.length ? (mappedCount / allMappings.length) * 100 : 100;
  const requiredReady = requiredMappings.every((item) => item.approved);

  const totalContacts = metricValue(metrics, 'total_contacts');
  const priorityLeads = metricValue(metrics, 'high_priority_contacts');
  const calls = metricValue(metrics, 'calls_last_30_days');
  const meetings = metricValue(metrics, 'meetings_last_30_days');
  const untouched = metricValue(metrics, 'untouched_contacts');
  const stale = metricValue(metrics, 'stale_contacts');
  const dealsAtRisk = metricValue(metrics, 'deals_at_risk');
  const openPipeline = metricValue(metrics, 'open_pipeline');
  const meetingRate = calls > 0 ? (meetings / calls) * 100 : 0;
  const attentionLoad = totalContacts > 0 ? Math.min(100, ((untouched + stale) / totalContacts) * 100) : 0;
  const executionScore = Math.max(0, 100 - attentionLoad);

  const recordCounts = Object.fromEntries(
    (selectedWorkspaceState?.recordCounts ?? []).map((item) => [item.object_type, Number(item.count ?? 0)])
  );
  const recordBars = [
    { label: 'Contacts', short: 'CO', value: recordCounts.contacts ?? 0 },
    { label: 'Companies', short: 'CP', value: recordCounts.companies ?? 0 },
    { label: 'Deals', short: 'DE', value: recordCounts.deals ?? 0 },
    { label: 'Calls', short: 'CA', value: recordCounts.calls ?? 0 },
    { label: 'Meetings', short: 'ME', value: recordCounts.meetings ?? 0 },
    { label: 'Tasks', short: 'TA', value: recordCounts.tasks ?? 0 }
  ];

  const motionRows = [
    { label: 'Portfolio contacts', value: totalContacts, tone: '#7c6cf2' },
    { label: 'Priority leads', value: priorityLeads, tone: '#f472b6' },
    { label: 'Calls · 30 days', value: calls, tone: '#38bdf8' },
    { label: 'Meetings · 30 days', value: meetings, tone: '#34d399' }
  ];

  const syncTime = selectedWorkspaceState?.freshness?.newest_record_sync ?? dashboard?.freshness?.latestSync;
  const syncHealthy = Boolean(syncTime) && Date.now() - new Date(syncTime).getTime() < 24 * 60 * 60 * 1000;
  const insightLead = dealsAtRisk > 0
    ? `${number(dealsAtRisk)} deals need immediate attention`
    : 'No at-risk deals are currently detected';
  const insightDetail = calls > 0
    ? `Your team converted ${percentage(meetingRate)} of calls into meetings over the last 30 days. ${number(untouched + stale)} contacts still need outreach or re-engagement.`
    : `Activity data is ready to populate as calls and meetings synchronize from HubSpot. ${number(untouched + stale)} contacts currently need attention.`;

  return (
    <div className={styles.appShell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>O</div>
          <div><strong>Ops Intelligence</strong><small>Revenue command center</small></div>
        </div>

        <nav className={styles.navigation}>
          <span>WORKSPACE</span>
          <a href="#overview" className={styles.navActive}><i>⌂</i>Overview</a>
          <a href="#team"><i>◎</i>Team performance</a>
          <a href="#focus"><i>◇</i>Today&apos;s focus</a>
          <a href="#health"><i>↻</i>Data health</a>
        </nav>

        <div className={styles.companySection}>
          <span>COMPANIES</span>
          <div className={styles.workspaceList}>
            {workspaces.map((item) => (
              <button
                key={item.workspace.id}
                className={item.workspace.id === selectedId ? styles.activeWorkspace : ''}
                onClick={() => changeWorkspace(item.workspace.id)}
              >
                <span>{initials(item.workspace.name)}</span>
                <div><strong>{item.workspace.name}</strong><small>{item.activeRun ? 'Syncing now' : 'Connected'}</small></div>
                <i />
              </button>
            ))}
          </div>
        </div>

        <div className={styles.sidebarHealth}>
          <div><span className={syncHealthy ? styles.liveDot : styles.warnDot} /><strong>{syncHealthy ? 'Data is live' : 'Review sync'}</strong></div>
          <small>Last updated {timeAgo(syncTime)}</small>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.breadcrumb}><span>Companies</span><i>/</i><strong>{selectedWorkspace.name}</strong></div>
          <div className={styles.topActions}>
            <span className={styles.periodBadge}>Last 30 days</span>
            <button className={styles.refreshButton} onClick={refreshDashboard} disabled={isPending}>{isPending ? 'Refreshing…' : 'Refresh data'}</button>
            <div className={styles.userBadge}>AM</div>
          </div>
        </header>

        <section className={styles.hero} id="overview">
          <div>
            <span className="eyebrow">EXECUTIVE OVERVIEW</span>
            <h1>Good decisions,<br /><em>before the next meeting.</em></h1>
            <p>A live view of pipeline, prospecting execution and the revenue signals that deserve attention right now.</p>
          </div>
          <div className={styles.heroMeta}>
            <span className={`${styles.statusPill} ${requiredReady ? styles.statusReady : styles.statusWarning}`}>
              <i />{requiredReady ? 'Analytics ready' : 'Mapping required'}
            </span>
            <small>Generated {date(dashboard?.generatedAt)}</small>
          </div>
        </section>

        {message && <div className={styles.error}>{message}</div>}

        <section className={styles.metricsGrid}>
          {KPI_KEYS.map((key) => <MetricCard key={key} metricKey={key} metric={metrics[key]} />)}
        </section>

        <section className={styles.executiveGrid}>
          <article className={`${styles.panel} ${styles.insightPanel}`}>
            <div className={styles.panelHeader}>
              <div><span className="section-label">EXECUTIVE SIGNAL</span><h2>{insightLead}</h2></div>
              <span className={styles.aiBadge}>Live insight</span>
            </div>
            <p>{insightDetail}</p>
            <div className={styles.insightStats}>
              <div><strong>{percentage(meetingRate)}</strong><span>Call-to-meeting rate</span></div>
              <div><strong>{number(untouched + stale)}</strong><span>Contacts needing action</span></div>
              <div><strong>{compact(openPipeline)}</strong><span>Open pipeline value</span></div>
            </div>
          </article>

          <article className={`${styles.panel} ${styles.scorePanel}`}>
            <div className={styles.panelHeader}><div><span className="section-label">EXECUTION SCORE</span><h2>Team momentum</h2></div></div>
            <RingChart value={executionScore} label="Healthy" detail={`${number(untouched + stale)} contacts are reducing the score.`} />
          </article>
        </section>

        <section className={styles.analysisGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span className="section-label">REVENUE MOTION</span><h2>From reach to meetings</h2></div>
              <span className={styles.subtleBadge}>Live totals</span>
            </div>
            <MotionFunnel rows={motionRows} />
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span className="section-label">CRM COVERAGE</span><h2>Record footprint</h2></div>
              <span className={styles.subtleBadge}>{compact(selectedWorkspaceState?.freshness?.total_records ?? dashboard?.freshness?.totalRecords)} records</span>
            </div>
            <MiniBars values={recordBars} />
            <div className={styles.recordLegend}>
              {recordBars.map((item) => <div key={item.label}><span>{item.label}</span><strong>{compact(item.value)}</strong></div>)}
            </div>
          </article>
        </section>

        <section className={styles.teamGrid} id="team">
          <article className={`${styles.panel} ${styles.leaderboardPanel}`}>
            <div className={styles.panelHeader}>
              <div><span className="section-label">TEAM EXECUTION</span><h2>Calls by owner</h2></div>
              <span className={styles.subtleBadge}>Last 30 days</span>
            </div>
            <div className={styles.leaderboard}>
              {leaderboard.slice(0, 8).map((item, index) => (
                <article key={item.key}>
                  <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
                  <div className={styles.avatar}>{initials(item.owner?.name)}</div>
                  <div className={styles.owner}>
                    <strong>{item.owner?.name}</strong>
                    <small>{item.owner?.email ?? 'No email available'}</small>
                    <div><i style={{ width: `${Math.max(4, (Number(item.value) / maxOwner) * 100)}%` }} /></div>
                  </div>
                  <b>{number(item.value)}</b>
                </article>
              ))}
              {leaderboard.length === 0 && <div className={styles.inlineEmpty}>Team activity will appear after call records synchronize.</div>}
            </div>
          </article>

          <article className={`${styles.panel} ${styles.pipelinePanel}`}>
            <div className={styles.panelHeader}><div><span className="section-label">PIPELINE HEALTH</span><h2>Revenue exposure</h2></div></div>
            <div className={styles.pipelineValue}><span>Open pipeline</span><strong>{compact(openPipeline)}</strong><small>Portal currency</small></div>
            <div className={styles.riskCallout}><span>!</span><div><strong>{number(dealsAtRisk)} deals at risk</strong><small>Overdue close date or no next activity</small></div></div>
            <div className={styles.pipelineFooter}>
              <div><span>Synced deals</span><strong>{compact(recordCounts.deals ?? 0)}</strong></div>
              <div><span>Freshness</span><strong>{timeAgo(syncTime)}</strong></div>
            </div>
          </article>
        </section>

        <section className={styles.focusSection} id="focus">
          <div className={styles.sectionHeading}>
            <div><span className="section-label">TODAY&apos;S FOCUS</span><h2>Turn insight into action.</h2></div>
            <button onClick={openDrilldown} disabled={isPending}>{isPending ? 'Loading queue…' : 'Open priority queue →'}</button>
          </div>
          <div className={styles.focusGrid}>
            <article><span style={{ '--focus-tone': '#f472b6' }}>◆</span><div><strong>{number(priorityLeads)}</strong><h3>Priority leads</h3><p>Highest-intent records detected by your CRM mapping.</p></div></article>
            <article><span style={{ '--focus-tone': '#fbbf24' }}>○</span><div><strong>{number(untouched)}</strong><h3>Untouched</h3><p>Created more than two days ago with no recorded contact.</p></div></article>
            <article><span style={{ '--focus-tone': '#fb923c' }}>⌁</span><div><strong>{number(stale)}</strong><h3>Stale</h3><p>Contacts that need re-engagement after 21 days.</p></div></article>
            <article><span style={{ '--focus-tone': '#fb7185' }}>!</span><div><strong>{number(dealsAtRisk)}</strong><h3>Deals at risk</h3><p>Revenue opportunities without a safe next step.</p></div></article>
          </div>
        </section>

        <section className={styles.healthGrid} id="health">
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div><span className="section-label">SEMANTIC READINESS</span><h2>CRM intelligence mapping</h2></div>
              <strong className={styles.mappingScore}>{Math.round(mappingScore)}%</strong>
            </div>
            <div className={styles.mappingProgress}><i style={{ width: `${mappingScore}%` }} /></div>
            <div className={styles.mappingList}>
              {allMappings.map((item) => (
                <article key={item.key}>
                  <span className={item.approved ? styles.dotReady : styles.dotPending} />
                  <div><strong>{item.key.replaceAll('_', ' ')}</strong><small>{requiredMappings.includes(item) ? 'Required' : 'Optional'}</small></div>
                  <b>{item.approved ? 'Mapped' : 'Pending'}</b>
                </article>
              ))}
            </div>
          </article>

          <article className={`${styles.panel} ${styles.healthPanel}`}>
            <div className={styles.panelHeader}><div><span className="section-label">DATA HEALTH</span><h2>Workspace status</h2></div></div>
            <div className={styles.healthRows}>
              <div><span><i className={syncHealthy ? styles.liveDot : styles.warnDot} />CRM synchronization</span><strong>{syncHealthy ? 'Healthy' : 'Needs review'}</strong></div>
              <div><span>Latest run</span><strong>{selectedWorkspaceState?.latestRun?.status ?? 'Not started'}</strong></div>
              <div><span>Last record update</span><strong>{timeAgo(syncTime)}</strong></div>
              <div><span>Analytics mappings</span><strong>{mappedCount}/{allMappings.length}</strong></div>
            </div>
            <a href="/operations">Open operations center →</a>
          </article>
        </section>

        {drilldown && (
          <section className={styles.tableCard}>
            <div className={styles.panelHeader}>
              <div><span className="section-label">ACTION QUEUE</span><h2>Priority leads needing attention</h2></div>
              <button className={styles.closeButton} onClick={() => setDrilldown(null)}>Close</button>
            </div>
            <div className={styles.table}>
              <div className={styles.tableHeader}><span>Contact</span><span>Email</span><span>Phone</span><span>Last contacted</span></div>
              {drilldown.results.map((row) => (
                <article key={row.id}>
                  <span><strong>{[row.properties.firstname, row.properties.lastname].filter(Boolean).join(' ') || `Contact ${row.id}`}</strong><small>HubSpot ID {row.id}</small></span>
                  <span>{row.properties.email || '—'}</span>
                  <span>{row.properties.phone || '—'}</span>
                  <span>{date(row.properties.notes_last_contacted)}</span>
                </article>
              ))}
              {drilldown.results.length === 0 && <div className={styles.inlineEmpty}>No priority leads currently require action.</div>}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
