'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import styles from './page.module.css';

const MODES = [
  { key: 'incremental', label: 'Refresh changes', description: 'Fast sync for records changed since the last successful run.' },
  { key: 'full', label: 'Full reconciliation', description: 'Re-reads every accessible object and refreshes associations.' },
  { key: 'initial', label: 'Initial rebuild', description: 'Recreates the first complete analytics copy for this workspace.' }
];

function formatNumber(value) { return new Intl.NumberFormat('en-US').format(Number(value ?? 0)); }
function formatDate(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function freshnessLabel(value) {
  if (!value) return { label: 'No data', tone: 'neutral' };
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes <= 20) return { label: `${minutes}m ago`, tone: 'healthy' };
  if (minutes <= 180) return { label: `${Math.round(minutes / 60)}h ago`, tone: 'warning' };
  return { label: `${Math.round(minutes / 1440)}d ago`, tone: 'danger' };
}

export default function OperationsClient() {
  const [accessKey, setAccessKey] = useState('');
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [isPending, startTransition] = useTransition();

  const selected = useMemo(
    () => workspaces.find((item) => item.workspace?.id === selectedId) ?? workspaces[0] ?? null,
    [selectedId, workspaces]
  );

  function securedHeaders(extra = {}) {
    return { 'x-operations-key': accessKey, ...extra };
  }

  async function unlock(event) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch('/api/operations/workspaces', { headers: securedHeaders(), cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.message ?? 'Unable to open operations center.');
        const results = payload.results ?? [];
        setWorkspaces(results);
        setSelectedId(results[0]?.workspace?.id ?? '');
        setAuthorized(true);
      } catch (error) {
        setMessage({ type: 'error', text: error.message });
      }
    });
  }

  async function refreshWorkspace(workspaceId, silent = false) {
    const response = await fetch(`/api/operations/${workspaceId}`, { headers: securedHeaders(), cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message ?? 'Unable to refresh synchronization status.');
    setWorkspaces((current) => current.map((item) => item.workspace?.id === workspaceId ? payload : item));
    if (!silent) setMessage({ type: 'success', text: 'Synchronization status refreshed.' });
  }

  async function runSync(mode) {
    if (!selected?.workspace?.id) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/operations/${selected.workspace.id}`, {
          method: 'POST',
          headers: securedHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify({ mode })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.message ?? 'Unable to queue synchronization.');
        setMessage({ type: 'success', text: `${mode} synchronization queued successfully.` });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await refreshWorkspace(selected.workspace.id, true);
      } catch (error) {
        setMessage({ type: 'error', text: error.message });
      }
    });
  }

  useEffect(() => {
    if (!authorized || !selected?.workspace?.id) return undefined;
    const timer = setInterval(() => {
      void refreshWorkspace(selected.workspace.id, true).catch(() => undefined);
    }, selected.activeRun ? 5000 : 30000);
    return () => clearInterval(timer);
  }, [authorized, selected?.workspace?.id, selected?.activeRun]);

  if (!authorized) {
    return (
      <section className={styles.accessGate}>
        <span className="eyebrow">PROTECTED OPERATIONS</span>
        <h1>Open the sync control center.</h1>
        <p>Enter the dedicated operations access key. The HubSpot admin key remains server-side and is never sent to the browser.</p>
        <form onSubmit={unlock}>
          <input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} type="password" autoComplete="current-password" placeholder="Operations access key" required />
          <button type="submit" disabled={isPending}>{isPending ? 'Checking…' : 'Continue'}</button>
        </form>
        {message && <div className={`${styles.notice} ${styles.noticeError}`}>{message.text}</div>}
      </section>
    );
  }

  if (!selected) return <section className={styles.emptyState}>No connected workspaces are available yet.</section>;

  const freshness = freshnessLabel(selected.freshness?.newest_record_sync);
  const totalRecords = Number(selected.freshness?.total_records ?? 0);
  const completed = selected.latestRun?.summary?.completed ?? [];
  const failed = selected.latestRun?.summary?.failed ?? [];

  return (
    <div className={styles.dashboardGrid}>
      <aside className={styles.workspaceRail}>
        <span className="section-label">WORKSPACES</span>
        <div className={styles.workspaceList}>
          {workspaces.map((item) => (
            <button className={`${styles.workspaceButton} ${item.workspace?.id === selected.workspace.id ? styles.workspaceButtonActive : ''}`} key={item.workspace?.id} onClick={() => setSelectedId(item.workspace.id)} type="button">
              <span>{item.workspace?.name}</span><small>{item.workspace?.slug}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className={styles.operationsPanel}>
        <header className={styles.operationsHeader}>
          <div><span className="eyebrow">SYNC CONTROL CENTER</span><h1>{selected.workspace.name}</h1><p>Monitor data freshness, object coverage and recovery operations without touching the server.</p></div>
          <div className={`${styles.healthBadge} ${styles[freshness.tone]}`}><span />{freshness.label}</div>
        </header>

        {message && <div className={`${styles.notice} ${message.type === 'error' ? styles.noticeError : ''}`}>{message.text}</div>}

        <div className={styles.kpiGrid}>
          <article><span>Total records</span><strong>{formatNumber(totalRecords)}</strong><small>Across all synchronized CRM objects</small></article>
          <article><span>Latest run</span><strong>{selected.latestRun?.status ?? 'Not started'}</strong><small>{formatDate(selected.latestRun?.completed_at ?? selected.latestRun?.started_at)}</small></article>
          <article><span>Active operation</span><strong>{selected.activeRun?.mode ?? 'Idle'}</strong><small>{selected.activeRun ? `Started ${formatDate(selected.activeRun.started_at)}` : 'No sync currently running'}</small></article>
          <article><span>Object coverage</span><strong>{selected.recordCounts?.length ?? 0}</strong><small>Contacts, companies, deals and activities</small></article>
        </div>

        <div className={styles.contentGrid}>
          <section className={styles.tableCard}>
            <div className={styles.cardHeader}><div><span className="section-label">DATA COVERAGE</span><h2>CRM objects</h2></div><button type="button" onClick={() => void refreshWorkspace(selected.workspace.id)} disabled={isPending}>Refresh</button></div>
            <div className={styles.objectTable}>
              {(selected.recordCounts ?? []).map((row) => {
                const cursor = selected.cursors?.find((item) => item.object_type === row.object_type);
                return <article key={row.object_type}><div><strong>{row.object_type}</strong><small>Last success {formatDate(cursor?.last_success_at)}</small></div><div><span>{formatNumber(row.count)}</span><small>{formatNumber(row.archived_count)} archived</small></div></article>;
              })}
              {selected.recordCounts?.length === 0 && <div className={styles.inlineEmpty}>No synchronized records yet.</div>}
            </div>
          </section>

          <section className={styles.actionsCard}>
            <span className="section-label">RECOVERY OPERATIONS</span><h2>Run synchronization</h2><p>Operations are deduplicated and blocked while another run is active.</p>
            <div className={styles.actionList}>{MODES.map((mode) => <button key={mode.key} type="button" onClick={() => runSync(mode.key)} disabled={isPending || Boolean(selected.activeRun)}><span><strong>{mode.label}</strong><small>{mode.description}</small></span><b>→</b></button>)}</div>
          </section>
        </div>

        <section className={styles.runCard}>
          <div className={styles.cardHeader}><div><span className="section-label">LATEST RUN</span><h2>Execution summary</h2></div><span className="pill">{selected.latestRun?.mode ?? 'none'}</span></div>
          <div className={styles.runSummary}><div><span>Completed objects</span><strong>{completed.length}</strong></div><div><span>Failed objects</span><strong>{failed.length}</strong></div><div><span>Started</span><strong>{formatDate(selected.latestRun?.started_at)}</strong></div><div><span>Completed</span><strong>{formatDate(selected.latestRun?.completed_at)}</strong></div></div>
          {selected.latestRun?.error && <pre className={styles.errorBlock}>{selected.latestRun.error}</pre>}
        </section>
      </section>
    </div>
  );
}
