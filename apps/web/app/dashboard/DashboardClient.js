'use client';

import { useMemo, useState, useTransition } from 'react';

import styles from './page.module.css';

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

function shortDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(parsed);
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

function humanize(value) {
  return String(value || 'Unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function metricValue(metrics, key) {
  const metric = metrics?.[key];
  return metric?.status === 'ready' ? Number(metric.value ?? 0) : 0;
}

function percent(value) {
  return `${Math.max(0, Math.min(100, Number(value || 0))).toFixed(1)}%`;
}

function MetricCard({ label, hint, value, icon, tone = 'teal', compactValue = false, footer }) {
  return (
    <article className={`${styles.metricCard} ${styles[`tone${tone}`] || ''}`}>
      <div className={styles.metricHeader}>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <strong>{compactValue ? compact(value) : number(value)}</strong>
      <small>{footer || hint}</small>
      <div className={styles.metricCorner} />
    </article>
  );
}

function ExecutionChart({ rows }) {
  const width = 760;
  const height = 270;
  const padX = 44;
  const padY = 30;
  const safeRows = rows?.length ? rows : [];
  const max = Math.max(1, ...safeRows.flatMap((row) => [row.calls, row.meetings, row.tasks]));
  const point = (value, index) => {
    const denominator = Math.max(1, safeRows.length - 1);
    const x = padX + (index / denominator) * (width - padX * 2);
    const y = height - padY - (Number(value || 0) / max) * (height - padY * 2);
    return `${x},${y}`;
  };
  const series = [
    { key: 'calls', label: 'Calls', color: '#0f766e' },
    { key: 'tasks', label: 'Tasks', color: '#f59e0b' },
    { key: 'meetings', label: 'Meetings', color: '#4f46e5' }
  ];

  if (!safeRows.length) {
    return <div className={styles.chartEmpty}>Activity history will appear after the next successful synchronization.</div>;
  }

  return (
    <div className={styles.executionChart}>
      <div className={styles.chartLegend}>
        {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily SDR execution over the last 21 days">
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = height - padY - ratio * (height - padY * 2);
          return <line key={ratio} x1={padX} x2={width - padX} y1={y} y2={y} className={styles.gridLine} />;
        })}
        {series.map((item) => (
          <polyline
            key={item.key}
            points={safeRows.map((row, index) => point(row[item.key], index)).join(' ')}
            fill="none"
            stroke={item.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {safeRows.map((row, index) => index % 4 === 0 || index === safeRows.length - 1 ? (
          <text key={row.day} x={point(0, index).split(',')[0]} y={height - 6} textAnchor="middle" className={styles.axisLabel}>
            {String(row.day).slice(5)}
          </text>
        ) : null)}
      </svg>
    </div>
  );
}

function ConversionFunnel({ rows }) {
  const safeRows = rows?.length ? rows : [];
  const max = Math.max(1, ...safeRows.map((row) => Number(row.value || 0)));
  const colors = ['#0f766e', '#16a34a', '#f59e0b', '#2563eb', '#7c3aed'];

  if (!safeRows.length) return <div className={styles.chartEmpty}>Funnel data is not available yet.</div>;

  return (
    <div className={styles.funnelWrap}>
      <div className={styles.funnelVisual}>
        {safeRows.map((row, index) => {
          const width = Math.max(20, (Number(row.value || 0) / max) * 100);
          return (
            <div
              key={row.key}
              className={styles.funnelStage}
              style={{ width: `${width}%`, background: colors[index % colors.length] }}
              title={`${row.label}: ${number(row.value)}`}
            />
          );
        })}
      </div>
      <div className={styles.funnelLegend}>
        {safeRows.map((row, index) => (
          <div key={row.key}><i style={{ background: colors[index % colors.length] }} /><span>{row.label}</span><strong>{compact(row.value)}</strong></div>
        ))}
      </div>
    </div>
  );
}

function LeadStatusChart({ rows }) {
  const safeRows = rows?.length ? rows : [];
  const max = Math.max(1, ...safeRows.map((row) => Number(row.value || 0)));
  if (!safeRows.length) return <div className={styles.chartEmpty}>Lead status values will appear after contact synchronization.</div>;

  return (
    <div className={styles.statusChart}>
      {safeRows.map((row) => (
        <div key={row.key}>
          <span title={humanize(row.key)}>{humanize(row.key)}</span>
          <div><i style={{ width: `${Math.max(2, (Number(row.value || 0) / max) * 100)}%` }} /></div>
          <strong>{number(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function AlertRow({ icon, tone, title, detail, value }) {
  return (
    <article className={styles.alertRow}>
      <span className={`${styles.alertIcon} ${styles[`alert${tone}`] || ''}`}>{icon}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
      <b>{number(value)}</b>
    </article>
  );
}

export default function DashboardClient() {
  const [accessKey, setAccessKey] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [drillOffset, setDrillOffset] = useState(0);
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

  async function loadDrilldown(workspaceId, offset = 0) {
    const response = await fetch(`/api/dashboard/${workspaceId}/drilldown?limit=20&offset=${offset}`, {
      headers: headers(),
      cache: 'no-store'
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.message ?? 'Unable to load lead details.');
    setDrilldown(result.drilldown);
    setDrillOffset(offset);
  }

  async function loadWorkspace(workspaceId, offset = 0) {
    await Promise.all([loadDashboard(workspaceId), loadDrilldown(workspaceId, offset)]);
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
        const workspaceId = rows[0]?.workspace?.id ?? '';
        setWorkspaces(rows);
        setSelectedId(workspaceId);
        setAuthorized(true);
        if (workspaceId) await loadWorkspace(workspaceId);
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function changeWorkspace(workspaceId) {
    setSelectedId(workspaceId);
    setDrilldown(null);
    setMessage(null);
    startTransition(() => loadWorkspace(workspaceId).catch((error) => setMessage(error.message)));
  }

  function refreshDashboard() {
    if (!selectedId) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/operations/workspaces', { headers: headers(), cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.message ?? 'Unable to refresh workspace status.');
        setWorkspaces(result.results ?? []);
        await loadWorkspace(selectedId, drillOffset);
      } catch (error) {
        setMessage(error.message);
      }
    });
  }

  function openPriorityQueue() {
    document.getElementById('priority-leads')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function changeDrillPage(nextOffset) {
    if (!selectedId || nextOffset < 0) return;
    setMessage(null);
    startTransition(() => loadDrilldown(selectedId, nextOffset).catch((error) => setMessage(error.message)));
  }

  if (!authorized) {
    return (
      <section className={styles.gate}>
        <div className={styles.gateBrand}><span>OI</span><div><strong>Ops Intelligence</strong><small>HubSpot command center</small></div></div>
        <span className={styles.gateEyebrow}>SECURE WORKSPACE ACCESS</span>
        <h1>Open your live<br />revenue workspace.</h1>
        <p>Unlock a tenant-isolated view of SDR execution, CRM quality, pipeline exposure and priority records.</p>
        <form onSubmit={unlock}>
          <input
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            placeholder="Workspace access key"
            autoComplete="current-password"
            required
          />
          <button disabled={isPending}>{isPending ? 'Opening workspace…' : 'Open dashboard'}</button>
        </form>
        <div className={styles.gateTrust}><span>Encrypted access</span><span>Tenant isolated</span><span>Live HubSpot data</span></div>
        {message && <div className={styles.error}>{message}</div>}
      </section>
    );
  }

  if (!selectedWorkspace) return <section className={styles.empty}>No connected workspaces are available.</section>;

  const totalContacts = metricValue(metrics, 'total_contacts');
  const priorityLeads = metricValue(metrics, 'high_priority_contacts');
  const calls = metricValue(metrics, 'calls_last_30_days');
  const meetings = metricValue(metrics, 'meetings_last_30_days');
  const untouched = metricValue(metrics, 'untouched_contacts');
  const stale = metricValue(metrics, 'stale_contacts');
  const contactsNeedingAction = metricValue(metrics, 'contacts_needing_action');
  const dealsAtRisk = metricValue(metrics, 'deals_at_risk');
  const openPipeline = metricValue(metrics, 'open_pipeline');
  const meetingRate = calls > 0 ? (meetings / calls) * 100 : 0;

  const operations = dashboard?.operationalSnapshot ?? {};
  const leaderboard = dashboard?.leaderboards?.activityByOwner?.value ?? [];
  const primaryOwner = leaderboard.find((item) => item.key !== 'Unassigned')?.owner ?? leaderboard[0]?.owner ?? null;
  const activityTrend = dashboard?.activityTrend ?? [];
  const conversionFunnel = dashboard?.conversionFunnel ?? [];
  const leadStatus = dashboard?.leadStatus ?? [];

  const requiredMappings = dashboard?.mappingReadiness?.required ?? [];
  const optionalMappings = dashboard?.mappingReadiness?.optional ?? [];
  const allMappings = [...requiredMappings, ...optionalMappings];
  const mappedCount = allMappings.filter((item) => item.approved).length;
  const mappingScore = allMappings.length ? Math.round((mappedCount / allMappings.length) * 100) : 100;

  const syncTime = selectedWorkspaceState?.freshness?.newest_record_sync ?? dashboard?.freshness?.latestSync;
  const syncHealthy = Boolean(syncTime) && Date.now() - new Date(syncTime).getTime() < 24 * 60 * 60 * 1000;
  const portalId = selectedWorkspace.portal_id;

  const kpis = [
    { label: 'SDR portfolio', hint: 'Contacts in your workspace', value: totalContacts, icon: '◉', tone: 'Teal' },
    { label: 'Companies', hint: 'Associated accounts', value: operations.totalCompanies, icon: '▦', tone: 'Blue' },
    { label: 'Calls', hint: 'Last 30 days', value: calls, icon: '⌕', tone: 'Cyan' },
    { label: 'Meetings', hint: 'Last 30 days', value: meetings, icon: '□', tone: 'Gold' },
    { label: 'Open tasks', hint: 'Outstanding activities', value: operations.openTasks, icon: '◌', tone: 'Blue' },
    { label: 'Meeting rate', hint: 'Meetings per call', value: meetingRate, icon: '%', tone: 'Violet', footer: percent(meetingRate) },
    { label: 'Open deals', hint: 'Active opportunities', value: operations.openDeals, icon: '▤', tone: 'Teal' },
    { label: 'Open pipeline', hint: 'Portal currency', value: openPipeline, icon: '◈', tone: 'Gold', compactValue: true }
  ];

  const focusCards = [
    { label: 'Untouched over 2 days', value: untouched, detail: 'No recorded contact', tone: 'Rose' },
    { label: 'No next activity', value: operations.noNextActivity, detail: 'Open deals without a next step', tone: 'Gold' },
    { label: 'Tasks due today', value: operations.tasksDueToday, detail: 'Open work due now', tone: 'Teal' },
    { label: 'High-priority tasks', value: operations.highPriorityTasks, detail: 'Priority queue', tone: 'Violet' },
    { label: 'Meeting conversion', value: percent(meetingRate), detail: 'Calls converted to meetings', tone: 'Blue', formatted: true },
    { label: 'Missing owner', value: operations.missingOwner, detail: 'Contacts without assignment', tone: 'Cyan' }
  ];

  const alerts = [
    { icon: '↗', tone: 'Teal', title: 'Tasks due today', detail: 'Open tasks scheduled for the current day.', value: operations.tasksDueToday },
    { icon: '!', tone: 'Rose', title: 'High-priority open tasks', detail: 'High-priority activities still waiting for action.', value: operations.highPriorityTasks },
    { icon: '△', tone: 'Rose', title: 'Overdue tasks', detail: 'Open tasks with a due date in the past.', value: operations.overdueTasks },
    { icon: '◇', tone: 'Gold', title: 'Deals with no next activity', detail: 'Open opportunities without a planned next step.', value: operations.noNextActivity },
    { icon: '○', tone: 'Gold', title: 'Untouched contacts', detail: 'Contacts older than two days with no outreach.', value: untouched },
    { icon: '◎', tone: 'Violet', title: 'Contacts needing attention', detail: 'Unique untouched or stale contacts.', value: contactsNeedingAction }
  ];

  return (
    <div className={styles.commandCenter}>
      <aside className={styles.sidebar}>
        <div className={styles.brandBlock}>
          <div className={styles.brandMark}>{initials(selectedWorkspace.name).slice(0, 1)}</div>
          <div><strong>{selectedWorkspace.name}</strong><small>SDR Intelligence</small></div>
        </div>

        <nav className={styles.navigation}>
          <span>MAIN</span>
          <a href="#overview" className={styles.navActive}><i>⌂</i>Overview<b>›</b></a>
          <a href="#sources"><i>◎</i>Lead sources</a>
          <a href="#activities"><i>⌁</i>Activities</a>
          <a href="#quality"><i>◇</i>Data quality</a>
          <a href="#companies"><i>▦</i>Companies & ATS</a>
          <a href="#pipeline"><i>▤</i>Pipeline</a>
        </nav>

        <div className={styles.ownerBlock}>
          <span>SDR OWNER</span>
          <article>
            <div>{initials(primaryOwner?.name || 'Workspace')}</div>
            <p><small>Reporting view</small><strong>{primaryOwner?.name || 'All SDR owners'}</strong></p>
            <i>✓</i>
          </article>
        </div>

        <div className={styles.workspaceSwitcher}>
          <span>COMPANIES</span>
          {workspaces.map((item) => (
            <button key={item.workspace.id} onClick={() => changeWorkspace(item.workspace.id)} className={item.workspace.id === selectedId ? styles.workspaceActive : ''}>
              <i>{initials(item.workspace.name)}</i><span>{item.workspace.name}</span><b />
            </button>
          ))}
        </div>

        <div className={styles.lastSync}>
          <i>▤</i><div><strong>Last sync</strong><small>{date(syncTime)}</small></div>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div><strong>SDR Command Center</strong><small>Live HubSpot performance & attribution</small></div>
          <div className={styles.topActions}>
            <span className={syncHealthy ? styles.liveBadge : styles.reviewBadge}><i />{syncHealthy ? 'LIVE · HUBSPOT' : 'SYNC REVIEW'}</span>
            <span className={styles.periodBadge}>Last 30 days</span>
            <button onClick={refreshDashboard} disabled={isPending}>↻ {isPending ? 'Refreshing…' : 'Refresh data'}</button>
          </div>
        </header>

        <div className={styles.content}>
          <section className={styles.pageIntro} id="overview">
            <span>{selectedWorkspace.name.toUpperCase()} · SDR PERFORMANCE</span>
            <h1>Overview</h1>
            <p>{shortDate(activityTrend[0]?.day)} – {shortDate(activityTrend.at(-1)?.day)} · Live workspace intelligence</p>
            <div className={styles.viewTabs}><button className={styles.activeTab}>↗ Analytics dashboard</button><a href="#priority-leads">◎ Priority workspace</a></div>
          </section>

          {message && <div className={styles.error}>{message}</div>}

          <section className={styles.metricsGrid}>
            {kpis.map((item) => <MetricCard key={item.label} {...item} />)}
          </section>

          <section className={styles.attentionPanel}>
            <div className={styles.panelTitleRow}>
              <div><span>TODAY&apos;S EXECUTION FOCUS</span><h2>What needs attention now</h2></div>
              <button onClick={openPriorityQueue}>Focus & action</button>
            </div>
            <div className={styles.focusGrid}>
              {focusCards.map((item) => (
                <article key={item.label} className={styles[`focus${item.tone}`]}>
                  <span>{item.label}</span><strong>{item.formatted ? item.value : number(item.value)}</strong><small>{item.detail}</small>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.chartGrid} id="activities">
            <article className={styles.panel}>
              <div className={styles.panelTitleRow}><div><h2>Daily SDR execution</h2><p>Calls, tasks and meetings across the last 21 days.</p></div><span className={styles.clickableBadge}>Live activity</span></div>
              <ExecutionChart rows={activityTrend} />
            </article>
            <article className={styles.panel}>
              <div className={styles.panelTitleRow}><div><h2>SDR conversion funnel</h2><p>CRM contacts progressing into revenue outcomes.</p></div><span className={styles.clickableBadge}>Live funnel</span></div>
              <ConversionFunnel rows={conversionFunnel} />
            </article>
          </section>

          <section className={styles.insightGrid}>
            <article className={styles.panel}>
              <div className={styles.panelTitleRow}><div><h2>Operational alerts</h2><p>Click the priority workspace to inspect affected records.</p></div></div>
              <div className={styles.alertList}>{alerts.map((item) => <AlertRow key={item.title} {...item} />)}</div>
            </article>
            <article className={styles.panel} id="sources">
              <div className={styles.panelTitleRow}><div><h2>Lead status</h2><p>HubSpot lifecycle and lead-status distribution.</p></div><span className={styles.clickableBadge}>{compact(totalContacts)} contacts</span></div>
              <LeadStatusChart rows={leadStatus} />
            </article>
          </section>

          <section className={styles.qualityStrip} id="quality">
            <div><span>CRM intelligence coverage</span><strong>{mappingScore}%</strong><small>{mappedCount} of {allMappings.length} semantic fields configured</small></div>
            <div className={styles.qualityProgress}><i style={{ width: `${mappingScore}%` }} /></div>
            <div><span>Data freshness</span><strong>{timeAgo(syncTime)}</strong><small>{selectedWorkspaceState?.latestRun?.status || 'Sync not started'}</small></div>
            <div id="pipeline"><span>Pipeline exposure</span><strong>{compact(openPipeline)}</strong><small>{number(dealsAtRisk)} deals at risk</small></div>
          </section>

          <section className={styles.tablePanel} id="priority-leads">
            <div className={styles.panelTitleRow}>
              <div><h2>Priority leads</h2><p>{drilldown?.fallback ? 'Attention-first fallback view while lead-quality mapping is being configured.' : 'Highest-priority contacts that need immediate follow-up.'}</p></div>
              <div className={styles.tableActions}>
                <button onClick={() => changeDrillPage(Math.max(0, drillOffset - 20))} disabled={isPending || drillOffset === 0}>Previous</button>
                <span>Rows {drillOffset + 1}–{drillOffset + (drilldown?.results?.length || 0)}</span>
                <button onClick={() => changeDrillPage(drillOffset + 20)} disabled={isPending || !drilldown?.hasMore}>Next</button>
              </div>
            </div>
            <div className={styles.tableScroll}>
              <div className={styles.tableHeader}><span>Priority</span><span>Contact</span><span>Company</span><span>Country</span><span>Owner</span><span>Lead status</span><span>Phone</span></div>
              {(drilldown?.results ?? []).map((row, index) => {
                const properties = row.properties || {};
                const contactName = [properties.firstname, properties.lastname].filter(Boolean).join(' ') || `Contact ${row.id}`;
                const owner = leaderboard.find((item) => String(item.owner?.id) === String(properties.hubspot_owner_id))?.owner;
                const hubspotUrl = portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${row.id}` : null;
                return (
                  <article key={row.id}>
                    <span className={styles.priorityNumber}>{String(drillOffset + index + 1).padStart(2, '0')}</span>
                    <span className={styles.contactCell}>
                      {hubspotUrl ? <a href={hubspotUrl} target="_blank" rel="noreferrer">{contactName}</a> : <strong>{contactName}</strong>}
                      <small>{properties.jobtitle || properties.email || `HubSpot ID ${row.id}`}</small>
                    </span>
                    <span>{properties.company || '—'}</span>
                    <span>{properties.country || '—'}</span>
                    <span>{owner?.name || properties.hubspot_owner_id || 'Unassigned'}</span>
                    <span><i className={styles.statusBadge}>{humanize(properties.hs_lead_status || properties.lifecyclestage)}</i></span>
                    <span>{properties.phone || properties.mobilephone || '—'}</span>
                  </article>
                );
              })}
              {!drilldown?.results?.length && <div className={styles.tableEmpty}>No contacts currently match the priority queue.</div>}
            </div>
          </section>

          <section className={styles.companyFooter} id="companies">
            <span>{operations.totalCompanies ? `${number(operations.totalCompanies)} connected companies` : 'Company intelligence ready'}</span>
            <strong>{selectedWorkspace.name}</strong>
            <small>Tenant-isolated HubSpot analytics · Generated {date(dashboard?.generatedAt)}</small>
          </section>
        </div>
      </main>
    </div>
  );
}
