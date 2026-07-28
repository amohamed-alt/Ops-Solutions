'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';

import { ProductFlowNav } from './ProductFlowNav';
import './command-center-v2.css';

type WorkspaceRow = {
  workspace: { id: string; name: string; hubspot_status?: string | null };
};

type Capabilities = {
  connected: boolean;
  scopes: string[];
  requiredScopes: Record<string, string[]>;
  can: Record<string, boolean>;
};

type WorkspaceAccess = {
  workspace: WorkspaceRow['workspace'];
  capabilities: Capabilities | null;
  error?: string;
};

async function json<T>(input: RequestInfo | URL): Promise<T> {
  const response = await fetch(input, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function missingScopes(capabilities: Capabilities | null) {
  if (!capabilities) return [];
  const required = new Set(Object.values(capabilities.requiredScopes ?? {}).flat());
  return [...required].filter((scope) => !capabilities.scopes.includes(scope)).sort();
}

export function HubSpotReconnectClient() {
  const [rows, setRows] = useState<WorkspaceAccess[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = await json<{ results?: WorkspaceRow[] }>('/api/customer/workspaces');
      const workspaces = result.results ?? [];
      const nextRows = await Promise.all(workspaces.map(async ({ workspace }) => {
        if (workspace.hubspot_status !== 'connected') {
          return { workspace, capabilities: null };
        }
        try {
          const capabilities = await json<Capabilities>(`/api/customer/workspaces/${encodeURIComponent(workspace.id)}/actions/capabilities`);
          return { workspace, capabilities };
        } catch (reason) {
          return {
            workspace,
            capabilities: null,
            error: reason instanceof Error ? reason.message : 'Unable to inspect HubSpot access.'
          };
        }
      }));
      setRows(nextRows);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load workspaces.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => {
    const connected = rows.filter((row) => row.workspace.hubspot_status === 'connected').length;
    const ready = rows.filter((row) => row.capabilities && missingScopes(row.capabilities).length === 0).length;
    return { connected, ready, needsReconnect: Math.max(0, connected - ready) };
  }, [rows]);

  return (
    <main className="cc2-shell" style={{ padding: 28 }}>
      <section className="cc2-hero ric-hero">
        <div>
          <span><ShieldAlert size={16} /> HUBSPOT ACCESS</span>
          <h1>Know exactly which workspaces need HubSpot reconnection</h1>
          <p>Compare granted scopes with the permissions required by guarded Ops Actions before a user attempts a write operation.</p>
        </div>
      </section>

      <ProductFlowNav
        current="reconnect"
        purpose="Use this page after Setup or Readiness to inspect HubSpot authorization. Reconnect only workspaces that are missing optional write scopes; read-only analytics can remain unchanged."
        nextSteps={[
          { label: 'Open Setup', href: '/setup', description: 'Start or repeat HubSpot OAuth authorization for the affected workspace.', badge: 'Reconnect' },
          { label: 'Review Ops Actions', href: '/settings/actions', description: 'Confirm create-task and lifecycle-stage capabilities after authorization.', badge: 'Verify' },
          { label: 'Open Readiness', href: '/settings/readiness', description: 'Review remaining product and delivery blockers.', badge: 'Audit' }
        ]}
      />

      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2>Authorization summary</h2>
            <p>Connected: {summary.connected} · Fully ready: {summary.ready} · Needs reconnect: {summary.needsReconnect}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={busy ? 'cc2-spin' : undefined} size={15} /> Refresh access
          </button>
        </header>
      </section>

      {error ? <div className="dashboard-rollout-recovery" role="alert"><strong>Unable to inspect access.</strong><p>{error}</p></div> : null}

      <div className="cc2-grid two">
        {rows.length === 0 && !busy ? <div className="cc2-empty">No customer workspaces are available.</div> : rows.map((row) => {
          const missing = missingScopes(row.capabilities);
          const connected = row.workspace.hubspot_status === 'connected';
          const ready = connected && row.capabilities && missing.length === 0;
          return (
            <article className="cc2-company-card" key={row.workspace.id}>
              <strong>{row.workspace.name}</strong>
              <span>{ready ? 'Write scopes ready' : connected ? 'Reconnect required' : 'HubSpot disconnected'}</span>
              <p>
                {row.error || (ready
                  ? 'This workspace has the scopes required by the current guarded actions.'
                  : missing.length
                    ? `Missing: ${missing.join(', ')}`
                    : 'Connect or reconnect this workspace through the Setup authorization flow.')}
              </p>
              {ready ? (
                <div className="cc2-empty" style={{ textAlign: 'left' }}><CheckCircle2 size={15} /> Authorization verified</div>
              ) : (
                <Link className="cc2-primary" href="/setup">Open Setup <ExternalLink size={14} /></Link>
              )}
            </article>
          );
        })}
      </div>
    </main>
  );
}

export { missingScopes };
