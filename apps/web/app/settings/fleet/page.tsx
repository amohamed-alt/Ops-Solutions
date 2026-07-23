'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Database,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Webhook
} from 'lucide-react';

import styles from './fleet.module.css';

type Workspace = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'viewer';
  portalId?: number | null;
  hubspotStatus?: string | null;
};

type FleetRow = {
  workspace: Workspace;
  health: { status: string; severity: string; message: string };
  hubspot: null | {
    portalId: number;
    status: string;
    connectedAt?: string;
    lastDiscoveredAt?: string;
    lastError?: string | null;
  };
  approvedMappings: number;
  pendingSuggestions: number;
  sync: {
    activeRun: null | { mode: string; status: string; started_at?: string };
    latestRun: null | { mode: string; status: string; error?: string; started_at?: string; completed_at?: string };
    freshness: null | { total_records: number; newest_record_sync?: string; oldest_record_sync?: string };
    webhooks?: {
      initialized?: boolean;
      received24h?: number;
      failed24h?: number;
      latestReceivedAt?: string | null;
      latestStatus?: string | null;
    };
  };
};

type LoadResult = {
  row: FleetRow | null;
  error: string | null;
  workspace: Workspace;
};

const roleRank = { viewer: 1, admin: 2, owner: 3 } as const;
const HEALTH_ORDER: Record<string, number> = {
  degraded: 0,
  disconnected: 1,
  stale: 2,
  initializing: 3,
  syncing: 4,
  healthy: 5
};

function title(value: string) {
  return String(value || 'unknown').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function number(value: unknown) {
  return new Intl.NumberFormat('en').format(Number(value || 0));
}

function when(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function age(value?: string | null) {
  if (!value) return 'Never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function healthIcon(status: string) {
  if (status === 'healthy') return <CheckCircle2 />;
  if (status === 'degraded' || status === 'disconnected') return <ShieldAlert />;
  if (status === 'syncing') return <Activity />;
  return <AlertTriangle />;
}

async function readOperations(workspace: Workspace): Promise<LoadResult> {
  try {
    const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspace.id)}/operations`, {
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'Unable to load workspace health.');
    return { row: payload as FleetRow, error: null, workspace };
  } catch (error) {
    return {
      row: null,
      error: error instanceof Error ? error.message : 'Unable to load workspace health.',
      workspace
    };
  }
}

export default function FleetOperationsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [rows, setRows] = useState<FleetRow[]>([]);
  const [failures, setFailures] = useState<LoadResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyWorkspaceId, setBusyWorkspaceId] = useState('');
  const [query, setQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [onlyNeedsAttention, setOnlyNeedsAttention] = useState(false);
  const [message, setMessage] = useState('');

  const loadFleet = useCallback(async (workspaceList: Workspace[]) => {
    if (workspaceList.length === 0) {
      setRows([]);
      setFailures([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    setMessage('');
    const results = await Promise.all(workspaceList.map(readOperations));
    setRows(results.flatMap((result) => result.row ? [result.row] : []));
    setFailures(results.filter((result) => result.error));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to monitor company operations.');
        return response.json();
      })
      .then(async (payload) => {
        if (!active) return;
        const list = (payload.workspaces ?? []) as Workspace[];
        setWorkspaces(list);
        await loadFleet(list);
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Unable to open fleet operations.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [loadFleet]);

  const summary = useMemo(() => {
    const totalRecords = rows.reduce((sum, row) => sum + Number(row.sync.freshness?.total_records ?? 0), 0);
    const failedWebhooks = rows.reduce((sum, row) => sum + Number(row.sync.webhooks?.failed24h ?? 0), 0);
    const healthy = rows.filter((row) => row.health.status === 'healthy').length;
    const attention = rows.filter((row) => row.health.status !== 'healthy' && row.health.status !== 'syncing').length + failures.length;
    return { totalRecords, failedWebhooks, healthy, attention };
  }, [rows, failures]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...rows]
      .filter((row) => {
        if (healthFilter !== 'all' && row.health.status !== healthFilter) return false;
        if (onlyNeedsAttention && ['healthy', 'syncing'].includes(row.health.status)) return false;
        if (!normalizedQuery) return true;
        return [row.workspace.name, row.workspace.role, row.health.status, String(row.hubspot?.portalId ?? '')]
          .some((value) => value.toLowerCase().includes(normalizedQuery));
      })
      .sort((left, right) => {
        const healthDifference = (HEALTH_ORDER[left.health.status] ?? 99) - (HEALTH_ORDER[right.health.status] ?? 99);
        if (healthDifference !== 0) return healthDifference;
        return left.workspace.name.localeCompare(right.workspace.name);
      });
  }, [rows, query, healthFilter, onlyNeedsAttention]);

  async function runSync(row: FleetRow, mode: 'incremental' | 'full') {
    if (busyWorkspaceId || roleRank[row.workspace.role] < roleRank.admin) return;
    setBusyWorkspaceId(row.workspace.id);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(row.workspace.id)}/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync', mode })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to queue synchronization.');
      setMessage(`${row.workspace.name}: ${title(mode)} synchronization queued.`);
      await loadFleet(workspaces);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to queue synchronization.');
    } finally {
      setBusyWorkspaceId('');
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span>MULTI-COMPANY OPERATIONS</span>
          <h1>Revenue operations fleet health</h1>
          <p>Monitor HubSpot connectivity, synchronization freshness, mapping readiness and webhook reliability across every company available to your account.</p>
        </div>
        <button type="button" onClick={() => void loadFleet(workspaces)} disabled={refreshing || loading}>
          <RefreshCw className={refreshing ? styles.spin : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh fleet'}
        </button>
      </header>

      {message ? <div className={styles.message}>{message}</div> : null}

      <section className={styles.summary} aria-label="Fleet summary">
        <article><Building2 /><div><strong>{number(rows.length)}</strong><span>Companies monitored</span></div></article>
        <article><ShieldCheck /><div><strong>{number(summary.healthy)}</strong><span>Healthy companies</span></div></article>
        <article><AlertTriangle /><div><strong>{number(summary.attention)}</strong><span>Need attention</span></div></article>
        <article><Database /><div><strong>{number(summary.totalRecords)}</strong><span>CRM records mirrored</span></div></article>
        <article><Webhook /><div><strong>{number(summary.failedWebhooks)}</strong><span>Webhook failures · 24h</span></div></article>
      </section>

      <section className={styles.toolbar}>
        <label className={styles.search}><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, portal, role or status" /></label>
        <label><Filter /><select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}>
          <option value="all">All health states</option>
          <option value="healthy">Healthy</option>
          <option value="syncing">Syncing</option>
          <option value="initializing">Initializing</option>
          <option value="stale">Stale</option>
          <option value="degraded">Degraded</option>
          <option value="disconnected">Disconnected</option>
        </select></label>
        <label className={styles.toggle}><input type="checkbox" checked={onlyNeedsAttention} onChange={(event) => setOnlyNeedsAttention(event.target.checked)} /><span />Needs attention only</label>
      </section>

      {loading ? <section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>Loading company health…</strong><span>Checking isolated workspaces and operational data.</span></section> : null}

      {!loading && workspaces.length === 0 ? <section className={styles.empty}><Building2 /><h2>No company workspaces found</h2><p>Create a company from onboarding, connect HubSpot, then return here to monitor the fleet.</p></section> : null}

      {!loading && filteredRows.length === 0 && rows.length > 0 ? <section className={styles.empty}><Search /><h2>No companies match these filters</h2><p>Clear the search or choose another health state.</p></section> : null}

      <section className={styles.grid} aria-label="Company operations health">
        {filteredRows.map((row) => {
          const canOperate = roleRank[row.workspace.role] >= roleRank.admin;
          const newestSync = row.sync.freshness?.newest_record_sync;
          const failedWebhooks = Number(row.sync.webhooks?.failed24h ?? 0);
          const isBusy = busyWorkspaceId === row.workspace.id;
          return <article key={row.workspace.id} className={`${styles.card} ${styles[row.health.severity] ?? ''}`}>
            <div className={styles.cardHeader}>
              <div className={styles.companyIdentity}><span>{row.workspace.name.slice(0, 2).toUpperCase()}</span><div><h2>{row.workspace.name}</h2><p>Portal {row.hubspot?.portalId ?? 'not connected'} · {title(row.workspace.role)}</p></div></div>
              <span className={`${styles.healthBadge} ${styles[row.health.status] ?? ''}`}>{healthIcon(row.health.status)}{title(row.health.status)}</span>
            </div>

            <p className={styles.healthMessage}>{row.health.message}</p>

            <div className={styles.metrics}>
              <div><span>CRM records</span><strong>{number(row.sync.freshness?.total_records)}</strong></div>
              <div><span>Approved mappings</span><strong>{number(row.approvedMappings)}</strong></div>
              <div><span>Mapping review</span><strong>{number(row.pendingSuggestions)}</strong></div>
              <div className={failedWebhooks > 0 ? styles.dangerMetric : ''}><span>Webhook failures</span><strong>{number(failedWebhooks)}</strong></div>
            </div>

            <dl className={styles.details}>
              <div><dt>Latest CRM refresh</dt><dd title={when(newestSync)}>{age(newestSync)}</dd></div>
              <div><dt>Latest webhook</dt><dd title={when(row.sync.webhooks?.latestReceivedAt)}>{age(row.sync.webhooks?.latestReceivedAt)}</dd></div>
              <div><dt>Latest sync</dt><dd>{row.sync.activeRun ? `${title(row.sync.activeRun.mode)} running` : title(row.sync.latestRun?.status || 'not started')}</dd></div>
              <div><dt>HubSpot OAuth</dt><dd>{title(row.hubspot?.status || 'disconnected')}</dd></div>
            </dl>

            {row.hubspot?.lastError || row.sync.latestRun?.error ? <div className={styles.errorDetail}><AlertTriangle /><span>{row.hubspot?.lastError || row.sync.latestRun?.error}</span></div> : null}

            <div className={styles.actions}>
              <a href={`/settings/workspace?workspaceId=${encodeURIComponent(row.workspace.id)}`}>Open operations <ArrowUpRight /></a>
              <a href={`/settings/mappings?workspaceId=${encodeURIComponent(row.workspace.id)}`}>Review mappings <ArrowUpRight /></a>
              <button type="button" onClick={() => void runSync(row, 'incremental')} disabled={!canOperate || Boolean(busyWorkspaceId) || Boolean(row.sync.activeRun)}>
                <RefreshCw className={isBusy ? styles.spin : ''} />{isBusy ? 'Queueing…' : 'Sync now'}
              </button>
            </div>
            {!canOperate ? <small className={styles.readOnly}>Viewer access is read-only for this company.</small> : null}
          </article>;
        })}
      </section>

      {failures.length > 0 ? <section className={styles.failures}>
        <div><ShieldAlert /><div><h2>Unavailable workspaces</h2><p>These companies could not be checked. No cross-company data was exposed.</p></div></div>
        {failures.map((failure) => <article key={failure.workspace.id}><strong>{failure.workspace.name}</strong><span>{failure.error}</span><a href={`/settings/workspace?workspaceId=${encodeURIComponent(failure.workspace.id)}`}>Open workspace</a></article>)}
      </section> : null}
    </main>
  );
}
