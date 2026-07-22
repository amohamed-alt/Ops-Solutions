'use client';

import { useMemo, useState, useTransition } from 'react';

import styles from './page.module.css';

const KPI_KEYS = ['total_contacts','high_priority_contacts','untouched_contacts','stale_contacts','open_pipeline','deals_at_risk','calls_last_30_days','meetings_last_30_days'];

function number(value) { return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(Number(value ?? 0)); }
function money(value) { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value ?? 0)); }
function date(value) { if (!value) return 'No data yet'; const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? 'No data yet' : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed); }
function initials(name) { return String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }

export default function DashboardClient() {
  const [accessKey, setAccessKey] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [payload, setPayload] = useState(null);
  const [drilldown, setDrilldown] = useState(null);
  const [message, setMessage] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selectedWorkspace = useMemo(() => workspaces.find((item) => item.workspace?.id === selectedId)?.workspace ?? null, [workspaces, selectedId]);
  const dashboard = payload?.dashboard;

  function headers() { return { 'x-operations-key': accessKey }; }

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
      } catch (error) { setMessage(error.message); }
    });
  }

  function changeWorkspace(workspaceId) {
    setSelectedId(workspaceId);
    setDrilldown(null);
    startTransition(() => loadDashboard(workspaceId).catch((error) => setMessage(error.message)));
  }

  function openDrilldown() {
    if (!selectedId) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/dashboard/${selectedId}/drilldown?limit=50&offset=0`, { headers: headers(), cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.message ?? 'Unable to load lead details.');
        setDrilldown(result.drilldown);
      } catch (error) { setMessage(error.message); }
    });
  }

  if (!authorized) return (
    <section className={styles.gate}>
      <span className="eyebrow">PROTECTED REVENUE INTELLIGENCE</span>
      <h1>Your SDR command center.</h1>
      <p>Unlock tenant-scoped analytics, pipeline health and action-ready lead drill-downs. Credentials stay on the server.</p>
      <form onSubmit={unlock}><input type="password" value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Operations access key" required/><button disabled={isPending}>{isPending ? 'Opening…' : 'Open dashboard'}</button></form>
      {message && <div className={styles.error}>{message}</div>}
    </section>
  );

  if (!selectedWorkspace) return <section className={styles.empty}>No connected workspaces are available.</section>;

  const metrics = dashboard?.metrics ?? {};
  const leaderboard = dashboard?.leaderboards?.activityByOwner?.value ?? [];
  const maxOwner = Math.max(1, ...leaderboard.map((item) => Number(item.value ?? 0)));
  const requiredReady = dashboard?.mappingReadiness?.required?.every((item) => item.approved);

  return (
    <div className={styles.layout}>
      <aside className={styles.rail}>
        <div><span className="section-label">WORKSPACES</span><h2>Companies</h2></div>
        <div className={styles.workspaceList}>{workspaces.map((item) => <button key={item.workspace.id} className={item.workspace.id === selectedId ? styles.activeWorkspace : ''} onClick={() => changeWorkspace(item.workspace.id)}><span>{initials(item.workspace.name)}</span><div><strong>{item.workspace.name}</strong><small>{item.workspace.slug}</small></div></button>)}</div>
      </aside>

      <section className={styles.content}>
        <header className={styles.hero}>
          <div><span className="eyebrow">SMART SDR DASHBOARD</span><h1>{selectedWorkspace.name}</h1><p>Live operational intelligence from HubSpot, normalized for every company workspace.</p></div>
          <div className={styles.statusStack}><span className={`${styles.status} ${requiredReady ? styles.ready : styles.warning}`}>{requiredReady ? 'Analytics ready' : 'Mapping required'}</span><small>Updated {date(dashboard?.generatedAt)}</small></div>
        </header>

        {message && <div className={styles.error}>{message}</div>}

        <div className={styles.kpis}>{KPI_KEYS.map((key) => { const metric = metrics[key] ?? {}; const monetary = key === 'open_pipeline'; return <article key={key} className={metric.status !== 'ready' ? styles.mutedCard : ''}><span>{metric.label ?? key}</span><strong>{metric.status === 'ready' ? (monetary ? money(metric.value) : number(metric.value)) : '—'}</strong><small>{metric.status === 'ready' ? metric.objectType : 'Configure mapping'}</small></article>; })}</div>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className="section-label">TEAM EXECUTION</span><h2>Calls by owner</h2></div><span className="pill">30 days</span></div>
            <div className={styles.leaderboard}>{leaderboard.slice(0, 8).map((item, index) => <article key={item.key}><span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span><div className={styles.avatar}>{initials(item.owner?.name)}</div><div className={styles.owner}><strong>{item.owner?.name}</strong><small>{item.owner?.email ?? 'No email'}</small><div><i style={{ width: `${Math.max(4, (Number(item.value) / maxOwner) * 100)}%` }} /></div></div><b>{number(item.value)}</b></article>)}{leaderboard.length === 0 && <div className={styles.inlineEmpty}>No call activity has been synchronized yet.</div>}</div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHead}><div><span className="section-label">CONFIGURATION</span><h2>Semantic readiness</h2></div></div>
            <div className={styles.mappingList}>{[...(dashboard?.mappingReadiness?.required ?? []).map((item) => ({...item, type:'Required'})), ...(dashboard?.mappingReadiness?.optional ?? []).map((item) => ({...item, type:'Optional'}))].map((item) => <article key={`${item.type}-${item.key}`}><span className={item.approved ? styles.dotReady : styles.dotPending}/><div><strong>{item.key.replaceAll('_', ' ')}</strong><small>{item.type}</small></div><b>{item.approved ? 'Mapped' : 'Pending'}</b></article>)}</div>
          </section>
        </div>

        <section className={styles.actionCard}>
          <div><span className="section-label">TODAY'S PRIORITY</span><h2>Leads needing action</h2><p>Open the highest-priority untouched and stale contacts, ready for SDR follow-up.</p></div>
          <button onClick={openDrilldown} disabled={isPending}>{isPending ? 'Loading…' : 'Open lead list →'}</button>
        </section>

        {drilldown && <section className={styles.tableCard}><div className={styles.cardHead}><div><span className="section-label">DRILL-DOWN</span><h2>Priority leads needing action</h2></div><button onClick={() => setDrilldown(null)}>Close</button></div><div className={styles.table}><div className={styles.tableHeader}><span>Name</span><span>Email</span><span>Phone</span><span>Last contacted</span></div>{drilldown.results.map((row) => <article key={row.id}><span><strong>{[row.properties.firstname,row.properties.lastname].filter(Boolean).join(' ') || `Contact ${row.id}`}</strong><small>#{row.id}</small></span><span>{row.properties.email || '—'}</span><span>{row.properties.phone || '—'}</span><span>{date(row.properties.notes_last_contacted)}</span></article>)}{drilldown.results.length === 0 && <div className={styles.inlineEmpty}>No priority leads currently require action.</div>}</div></section>}
      </section>
    </div>
  );
}
