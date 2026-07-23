'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, CloudOff, Download, Filter, LoaderCircle, RefreshCw, Search, ShieldAlert } from 'lucide-react';

import styles from './sla.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer'; portalId?: number | null; hubspotStatus?: string | null };
type Operations = {
  workspace: Workspace;
  health: { status: string; severity: string; message: string };
  approvedMappings: number;
  pendingSuggestions: number;
  webhookHealth?: { total24h?: number; failed24h?: number; lastReceivedAt?: string | null; latestStatus?: string | null } | null;
  sync: {
    activeRun: null | { mode?: string; status?: string; started_at?: string | null };
    latestRun: null | { mode?: string; status?: string; error?: string | null; completed_at?: string | null };
    freshness: null | { total_records?: number; newest_record_sync?: string | null };
  };
};

type Row = {
  workspace: Workspace;
  operations: Operations | null;
  error: string | null;
  grade: 'healthy' | 'warning' | 'critical' | 'unknown';
  breaches: string[];
  syncAgeMinutes: number | null;
};

const REFRESH_MS = 60_000;
const WARNING_MINUTES = 90;
const CRITICAL_MINUTES = 24 * 60;

function ageMinutes(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
}

function classify(workspace: Workspace, operations: Operations | null, error: string | null): Pick<Row, 'grade' | 'breaches' | 'syncAgeMinutes'> {
  if (error || !operations) return { grade: 'unknown', breaches: [error || 'Operational status unavailable'], syncAgeMinutes: null };
  const breaches: string[] = [];
  const syncAgeMinutes = ageMinutes(operations.sync.freshness?.newest_record_sync);
  const failedWebhooks = Number(operations.webhookHealth?.failed24h || 0);

  if (workspace.hubspotStatus !== 'connected' || operations.health.status === 'disconnected') breaches.push('HubSpot disconnected');
  if (operations.health.status === 'degraded' || operations.sync.latestRun?.status === 'failed') breaches.push('Latest synchronization failed');
  if (failedWebhooks > 0) breaches.push(`${failedWebhooks} failed webhook event${failedWebhooks === 1 ? '' : 's'} in 24h`);
  if (operations.pendingSuggestions > 0) breaches.push(`${operations.pendingSuggestions} mapping suggestion${operations.pendingSuggestions === 1 ? '' : 's'} awaiting review`);
  if (syncAgeMinutes === null) breaches.push('No synchronized CRM freshness timestamp');
  else if (syncAgeMinutes > CRITICAL_MINUTES) breaches.push(`CRM mirror is ${Math.floor(syncAgeMinutes / 60)}h stale`);
  else if (syncAgeMinutes > WARNING_MINUTES) breaches.push(`CRM mirror is ${syncAgeMinutes}m old`);

  const critical = breaches.some((item) => /disconnected|failed|No synchronized|\dh stale/.test(item));
  return { grade: critical ? 'critical' : breaches.length ? 'warning' : 'healthy', breaches, syncAgeMinutes };
}

function relativeAge(minutes: number | null) {
  if (minutes === null) return 'Not available';
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

function downloadSnapshot(rows: Row[]) {
  const payload = {
    generatedAt: new Date().toISOString(),
    policy: { warningMinutes: WARNING_MINUTES, criticalMinutes: CRITICAL_MINUTES },
    workspaces: rows.map((row) => ({
      workspaceId: row.workspace.id,
      workspaceName: row.workspace.name,
      portalId: row.workspace.portalId ?? null,
      grade: row.grade,
      breaches: row.breaches,
      syncAgeMinutes: row.syncAgeMinutes,
      totalRecords: Number(row.operations?.sync.freshness?.total_records || 0),
      failedWebhooks24h: Number(row.operations?.webhookHealth?.failed24h || 0),
      pendingMappings: Number(row.operations?.pendingSuggestions || 0)
    }))
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ops-data-sla-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export default function DataSlaPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Row['grade']>('all');
  const [message, setMessage] = useState('');
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!navigator.onLine) return;
    if (silent) setRefreshing(true); else setLoading(true);
    setMessage('');
    try {
      const sessionResponse = await fetch('/api/customer/auth/session', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok) throw new Error(session.message || 'Sign in to review data SLAs.');
      const workspaces = (session.workspaces || []) as Workspace[];
      const results = await Promise.all(workspaces.map(async (workspace): Promise<Row> => {
        try {
          const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspace.id)}/operations`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.message || 'Operational status unavailable');
          const operations = payload as Operations;
          return { workspace, operations, error: null, ...classify(workspace, operations, null) };
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Operational status unavailable';
          return { workspace, operations: null, error: reason, ...classify(workspace, null, reason) };
        }
      }));
      setRows(results.sort((a, b) => ({ critical: 0, warning: 1, unknown: 2, healthy: 3 }[a.grade] - { critical: 0, warning: 1, unknown: 2, healthy: 3 }[b.grade] || a.workspace.name.localeCompare(b.workspace.name))));
      setLastCheckedAt(new Date());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to build the data SLA console.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { setOnline(navigator.onLine); void load(); }, [load]);
  useEffect(() => {
    const onOnline = () => { setOnline(true); void load(true); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void load(true);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleRows = useMemo(() => rows.filter((row) => {
    const matchesFilter = filter === 'all' || row.grade === filter;
    const haystack = `${row.workspace.name} ${row.workspace.portalId || ''} ${row.breaches.join(' ')}`.toLowerCase();
    return matchesFilter && haystack.includes(query.trim().toLowerCase());
  }), [filter, query, rows]);
  const counts = useMemo(() => rows.reduce((acc, row) => ({ ...acc, [row.grade]: acc[row.grade] + 1 }), { healthy: 0, warning: 0, critical: 0, unknown: 0 }), [rows]);

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div><span>DATA RELIABILITY</span><h1>Workspace data SLA console</h1><p>Track CRM freshness, webhook delivery, mapping readiness and connection health across every company.</p></div>
        <div className={styles.heroActions}>
          <button onClick={() => downloadSnapshot(rows)} disabled={!rows.length}><Download size={16} />Export snapshot</button>
          <button className={styles.primary} onClick={() => void load(true)} disabled={refreshing || !online}><RefreshCw className={refreshing ? styles.spin : ''} size={16} />Refresh</button>
        </div>
      </header>

      {!online ? <div className={styles.offline}><CloudOff size={18} />Offline. Automatic checks resume when connectivity returns.</div> : null}
      {message ? <div className={styles.error}><ShieldAlert size={18} />{message}</div> : null}

      <section className={styles.scorecards}>
        <article><CheckCircle2 /><div><strong>{counts.healthy}</strong><span>Meeting SLA</span></div></article>
        <article><Clock3 /><div><strong>{counts.warning}</strong><span>Needs review</span></div></article>
        <article><AlertTriangle /><div><strong>{counts.critical}</strong><span>Critical breach</span></div></article>
        <article><Activity /><div><strong>{rows.length}</strong><span>Total companies</span></div></article>
      </section>

      <section className={styles.toolbar}>
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, portal or breach" /></label>
        <label><Filter size={16} /><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All statuses</option><option value="healthy">Healthy</option><option value="warning">Warning</option><option value="critical">Critical</option><option value="unknown">Unknown</option></select></label>
        <span>Policy: warning after {WARNING_MINUTES} min · critical after 24 hr</span>
        <small>{lastCheckedAt ? `Last checked ${lastCheckedAt.toLocaleTimeString()}` : 'Not checked yet'}</small>
      </section>

      {loading ? <section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>Evaluating workspace reliability…</strong></section> : (
        <section className={styles.grid}>
          {visibleRows.map((row) => <article key={row.workspace.id} className={`${styles.card} ${styles[row.grade]}`}>
            <header><div><small>{row.workspace.portalId ? `Portal ${row.workspace.portalId}` : 'No portal connected'}</small><h2>{row.workspace.name}</h2></div><span>{row.grade}</span></header>
            <dl>
              <div><dt>CRM freshness</dt><dd>{relativeAge(row.syncAgeMinutes)}</dd></div>
              <div><dt>Mirrored records</dt><dd>{new Intl.NumberFormat('en').format(Number(row.operations?.sync.freshness?.total_records || 0))}</dd></div>
              <div><dt>Failed webhooks (24h)</dt><dd>{Number(row.operations?.webhookHealth?.failed24h || 0)}</dd></div>
              <div><dt>Pending mappings</dt><dd>{Number(row.operations?.pendingSuggestions || 0)}</dd></div>
            </dl>
            <div className={styles.breaches}>{row.breaches.length ? row.breaches.map((breach) => <p key={breach}><AlertTriangle size={14} />{breach}</p>) : <p><CheckCircle2 size={14} />All monitored reliability objectives are met.</p>}</div>
            <footer><Link href={`/settings/workspace?workspaceId=${encodeURIComponent(row.workspace.id)}`}>Open operations</Link><Link href={`/settings/mappings?workspaceId=${encodeURIComponent(row.workspace.id)}`}>Review mappings</Link></footer>
          </article>)}
          {!visibleRows.length ? <div className={styles.empty}>No workspaces match the selected search and status filters.</div> : null}
        </section>
      )}
    </main>
  );
}
