'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gauge, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';

import { ProductFlowNav } from './ProductFlowNav';
import { calculateWorkspaceReadiness } from './readiness-model.js';
import './command-center-v2.css';

type WorkspaceRow = {
  workspace: {
    id: string;
    name: string;
    hubspot_status?: string | null;
  };
  newest_record_sync?: string | null;
  total_records?: number | string | null;
};

type Capabilities = {
  can?: {
    createTask?: boolean;
    updateLifecycleStage?: boolean;
  };
};

type CountResult = { results?: unknown[] };

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function statusLabel(state: string) {
  if (state === 'ready') return 'Ready for pilot use';
  if (state === 'blocked') return 'Connection required';
  return 'Needs attention';
}

export function WorkspaceReadinessClient() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities>({});
  const [savedViewCount, setSavedViewCount] = useState(0);
  const [scheduleCount, setScheduleCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedWorkspace = useMemo(
    () => workspaces.find((row) => row.workspace.id === workspaceId) ?? null,
    [workspaces, workspaceId]
  );

  const readiness = useMemo(() => calculateWorkspaceReadiness({
    hubspotStatus: selectedWorkspace?.workspace.hubspot_status,
    newestRecordSync: selectedWorkspace?.newest_record_sync,
    savedViewCount,
    scheduleCount,
    canCreateTask: capabilities.can?.createTask,
    canUpdateLifecycleStage: capabilities.can?.updateLifecycleStage
  }), [selectedWorkspace, savedViewCount, scheduleCount, capabilities]);

  async function loadWorkspaceDetails(id: string) {
    if (!id) return;
    setBusy(true);
    setError('');
    try {
      const [capabilityResult, viewsResult, schedulesResult] = await Promise.all([
        json<Capabilities>(`/api/customer/workspaces/${encodeURIComponent(id)}/actions/capabilities`).catch(() => ({})),
        json<CountResult>(`/api/customer/workspaces/${encodeURIComponent(id)}/saved-views`).catch(() => ({ results: [] })),
        json<CountResult>(`/api/customer/workspaces/${encodeURIComponent(id)}/report-schedules`).catch(() => ({ results: [] }))
      ]);
      setCapabilities(capabilityResult);
      setSavedViewCount(viewsResult.results?.length ?? 0);
      setScheduleCount(schedulesResult.results?.length ?? 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to calculate workspace readiness.');
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    setBusy(true);
    setError('');
    try {
      const result = await json<{ results?: WorkspaceRow[] }>('/api/customer/workspaces');
      const rows = result.results ?? [];
      setWorkspaces(rows);
      const nextId = workspaceId || rows[0]?.workspace.id || '';
      setWorkspaceId(nextId);
      if (nextId) await loadWorkspaceDetails(nextId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load workspace readiness.');
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const StateIcon = readiness.state === 'ready'
    ? CheckCircle2
    : readiness.state === 'blocked'
      ? XCircle
      : AlertTriangle;

  return (
    <main className="cc2-shell" style={{ padding: 28 }}>
      <section className="cc2-hero ric-hero">
        <div>
          <span><Gauge size={16} /> WORKSPACE READINESS</span>
          <h1>See what is operational, what is optional, and what is blocking launch</h1>
          <p>This center calculates readiness from current workspace connection, sync freshness, reporting assets, schedules, and HubSpot write capabilities.</p>
        </div>
      </section>

      <ProductFlowNav
        current="readiness"
        purpose="Use this page before onboarding a customer or enabling automation. It reads existing product APIs and turns configuration gaps into a practical launch checklist."
        nextSteps={[
          { label: 'Fix connection or setup', href: '/setup', description: 'Connect HubSpot and complete workspace onboarding when readiness is blocked.', badge: 'Configure' },
          { label: 'Create reporting assets', href: '/builder', description: 'Build a saved report, dashboard definition, or recurring email schedule.', badge: 'Build' },
          { label: 'Verify dashboard output', href: '/dashboard', description: 'Confirm KPIs, drilldowns, and data freshness after readiness improves.', badge: 'Validate' }
        ]}
      />

      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2><ShieldCheck size={18} /> Workspace assessment</h2>
            <p>Select a workspace to recalculate its current operational readiness.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => void load()}>
            <RefreshCw className={busy ? 'cc2-spin' : undefined} size={15} /> Refresh
          </button>
        </header>
        <div className="cc2-panel-body" style={{ display: 'grid', gap: 14 }}>
          <label className="cc2-company">
            <span>Workspace</span>
            <select value={workspaceId} onChange={(event) => {
              const id = event.target.value;
              setWorkspaceId(id);
              void loadWorkspaceDetails(id);
            }}>
              {workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}
            </select>
          </label>

          {selectedWorkspace ? (
            <div className="cc2-company-card">
              <strong><StateIcon size={17} /> {statusLabel(readiness.state)}</strong>
              <span>{readiness.score}% readiness · {readiness.readyCount} of {readiness.totalCount} checks ready</span>
              <p>
                {selectedWorkspace.workspace.name} · {Number(selectedWorkspace.total_records || 0).toLocaleString()} synchronized records
              </p>
            </div>
          ) : <div className="cc2-empty">No workspace is available yet. Start in Setup.</div>}
        </div>
      </section>

      {error ? <div className="dashboard-rollout-recovery" role="alert"><strong>Readiness check failed.</strong><p>{error}</p></div> : null}

      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2>Capability matrix</h2>
            <p>Required analytics checks and optional write capabilities are scored separately.</p>
          </div>
        </header>
        <div className="cc2-panel-body cc2-grid two">
          {readiness.checks.map((check: any) => (
            <article key={check.key} className="cc2-company-card">
              <strong>{check.ready ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {check.label}</strong>
              <span>{check.ready ? 'Ready' : check.optional ? 'Optional setup' : 'Action required'} · {check.weight} points</span>
              <p>{check.detail}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
