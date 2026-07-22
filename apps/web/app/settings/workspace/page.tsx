'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Building2, CheckCircle2, Database, HardDriveDownload, LoaderCircle, PlugZap, Radio, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';

import styles from './workspace.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer'; portalId?: number | null; hubspotStatus?: string | null };
type Operations = {
  workspace: Workspace;
  health: { status: string; severity: string; message: string };
  hubspot: null | { portalId: number; status: string; connectedAt?: string; lastDiscoveredAt?: string; lastError?: string | null; scopes?: string[] };
  propertyCounts: Array<{ object_type: string; count: number }>;
  approvedMappings: number;
  pendingSuggestions: number;
  latestDiscovery: null | { status: string; error?: string; started_at?: string; completed_at?: string };
  sync: {
    activeRun: null | { mode: string; status: string; started_at?: string };
    latestRun: null | { mode: string; status: string; error?: string; started_at?: string; completed_at?: string };
    recordCounts: Array<{ object_type: string; count: number; archived_count: number }>;
    freshness: null | { total_records: number; newest_record_sync?: string; oldest_record_sync?: string };
    webhooks: { initialized: boolean; received24h: number; failed24h: number; latestReceivedAt?: string | null; latestStatus?: string | null };
  };
};

const roleRank = { viewer: 1, admin: 2, owner: 3 };

function number(value: unknown) {
  return new Intl.NumberFormat('en').format(Number(value || 0));
}

function when(value?: string | null) {
  if (!value) return 'Not available yet';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function WorkspaceSettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [operations, setOperations] = useState<Operations | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canOperate = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);
  const totalRecords = Number(operations?.sync.freshness?.total_records ?? 0);

  const load = useCallback(async (id: string) => {
    setBusy('refresh');
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/operations`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to load workspace operations.');
      setOperations(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load workspace operations.');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to manage workspace operations.');
        const payload = await response.json();
        const rows = (payload.workspaces ?? []) as Workspace[];
        const requested = new URLSearchParams(window.location.search).get('workspaceId') ?? '';
        setWorkspaces(rows);
        setWorkspaceId(rows.some((item) => item.id === requested) ? requested : (rows[0]?.id ?? ''));
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId, load]);

  async function run(action: 'discover' | 'sync' | 'reconnect', mode?: 'incremental' | 'full') {
    if (!workspaceId || busy) return;
    setBusy(mode || action);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/operations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, mode })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Workspace operation failed.');
      if (action === 'reconnect' && payload.authorizationUrl) {
        window.location.assign(payload.authorizationUrl);
        return;
      }
      setMessage(action === 'discover' ? 'CRM discovery completed successfully.' : `${title(mode || 'sync')} synchronization queued.`);
      await load(workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Workspace operation failed.');
      setBusy('');
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><span>WORKSPACE OPERATIONS</span><h1>HubSpot connection & data health</h1><p>Monitor every company connection, webhook freshness, CRM structure, and synchronization recovery from one place.</p></div>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </header>

      {message ? <div className={styles.message}>{message}</div> : null}
      {!operations ? <section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>Loading workspace health…</strong></section> : <>
        <section className={`${styles.health} ${styles[operations.health.severity]}`}>
          <span>{operations.health.severity === 'success' ? <CheckCircle2 /> : operations.health.severity === 'critical' ? <AlertTriangle /> : <Activity />}</span>
          <div><small>OVERALL STATUS</small><h2>{title(operations.health.status)}</h2><p>{operations.health.message}</p></div>
          <button onClick={() => void load(workspaceId)} disabled={Boolean(busy)}><RefreshCw className={busy === 'refresh' ? styles.spin : ''} />Refresh</button>
        </section>

        <section className={styles.stats}>
          <article><Building2 /><div><strong>{operations.hubspot?.portalId ?? '—'}</strong><span>HubSpot portal</span></div></article>
          <article><Database /><div><strong>{number(totalRecords)}</strong><span>Synchronized records</span></div></article>
          <article><Radio /><div><strong>{number(operations.sync.webhooks.received24h)}</strong><span>Webhook events · 24h</span></div></article>
          <article><ShieldCheck /><div><strong>{number(operations.approvedMappings)}</strong><span>Approved mappings</span></div></article>
        </section>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Connection details</h2><p>OAuth, discovery and scope health for this company.</p></div><PlugZap /></div>
            <dl>
              <div><dt>Status</dt><dd>{title(operations.hubspot?.status || 'disconnected')}</dd></div>
              <div><dt>Connected</dt><dd>{when(operations.hubspot?.connectedAt)}</dd></div>
              <div><dt>Last discovery</dt><dd>{when(operations.hubspot?.lastDiscoveredAt)}</dd></div>
              <div><dt>Properties discovered</dt><dd>{number(operations.propertyCounts.reduce((sum, row) => sum + Number(row.count || 0), 0))}</dd></div>
              <div><dt>Pending mapping review</dt><dd>{number(operations.pendingSuggestions)}</dd></div>
            </dl>
            <div className={styles.actions}>
              <button onClick={() => void run('reconnect')} disabled={!canOperate || Boolean(busy)}><PlugZap />Reconnect HubSpot</button>
              <button onClick={() => void run('discover')} disabled={!canOperate || Boolean(busy) || !operations.hubspot}><RotateCcw className={busy === 'discover' ? styles.spin : ''} />Rediscover CRM</button>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Synchronization controls</h2><p>Run safe incremental updates or a complete reconciliation.</p></div><RefreshCw /></div>
            <dl>
              <div><dt>Active run</dt><dd>{operations.sync.activeRun ? `${title(operations.sync.activeRun.mode)} · ${title(operations.sync.activeRun.status)}` : 'No active run'}</dd></div>
              <div><dt>Latest completed</dt><dd>{when(operations.sync.latestRun?.completed_at)}</dd></div>
              <div><dt>Newest CRM record sync</dt><dd>{when(operations.sync.freshness?.newest_record_sync)}</dd></div>
              <div><dt>Oldest CRM record sync</dt><dd>{when(operations.sync.freshness?.oldest_record_sync)}</dd></div>
              <div><dt>Your access</dt><dd>{workspace?.role ? title(workspace.role) : '—'}</dd></div>
            </dl>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => void run('sync', 'incremental')} disabled={!canOperate || Boolean(busy) || Boolean(operations.sync.activeRun)}><RefreshCw className={busy === 'incremental' ? styles.spin : ''} />Incremental sync</button>
              <button onClick={() => void run('sync', 'full')} disabled={!canOperate || Boolean(busy) || Boolean(operations.sync.activeRun)}><Database className={busy === 'full' ? styles.spin : ''} />Full reconciliation</button>
            </div>
            {!canOperate ? <p className={styles.locked}>Viewer access can monitor health. Admin or owner access is required to run operations.</p> : null}
          </section>
        </div>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Webhook delivery</h2><p>Near-real-time HubSpot event ingestion and reconciliation status.</p></div><Radio /></div>
            <dl>
              <div><dt>Receiver</dt><dd>{operations.sync.webhooks.initialized ? 'Ready' : 'Initializing'}</dd></div>
              <div><dt>Events received · 24h</dt><dd>{number(operations.sync.webhooks.received24h)}</dd></div>
              <div><dt>Failures · 24h</dt><dd>{number(operations.sync.webhooks.failed24h)}</dd></div>
              <div><dt>Latest delivery</dt><dd>{when(operations.sync.webhooks.latestReceivedAt)}</dd></div>
              <div><dt>Latest status</dt><dd>{operations.sync.webhooks.latestStatus ? title(operations.sync.webhooks.latestStatus) : 'No events yet'}</dd></div>
            </dl>
            <p className={styles.locked}>Webhook events trigger deduplicated synchronization. Deleted records are archived immediately and associations are removed safely.</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Latest data operation</h2><p>Current processing state and latest background result.</p></div><HardDriveDownload /></div>
            <dl>
              <div><dt>Latest sync status</dt><dd>{operations.sync.latestRun?.status ? title(operations.sync.latestRun.status) : 'Not started'}</dd></div>
              <div><dt>Latest sync mode</dt><dd>{operations.sync.latestRun?.mode ? title(operations.sync.latestRun.mode) : '—'}</dd></div>
              <div><dt>Completed</dt><dd>{when(operations.sync.latestRun?.completed_at)}</dd></div>
              <div><dt>CRM mirror</dt><dd>{number(totalRecords)} active and archived records</dd></div>
              <div><dt>Connection</dt><dd>{operations.hubspot?.status ? title(operations.hubspot.status) : 'Disconnected'}</dd></div>
            </dl>
          </section>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>CRM object coverage</h2><p>Live record counts from the isolated PostgreSQL mirror for this workspace.</p></div><Database /></div>
          <div className={styles.objects}>{operations.sync.recordCounts.map((row) => <article key={row.object_type}><span>{title(row.object_type)}</span><strong>{number(row.count)}</strong><small>{number(row.archived_count)} archived</small></article>)}{operations.sync.recordCounts.length === 0 ? <p className={styles.empty}>No synchronized objects yet. Connect HubSpot and run the initial sync.</p> : null}</div>
        </section>
      </>}
    </main>
  );
}
