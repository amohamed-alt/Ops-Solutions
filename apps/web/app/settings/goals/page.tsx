'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, Building2, CheckCircle2, Gauge, LoaderCircle, Save, Target, UsersRound } from 'lucide-react';

import styles from './goals.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type OwnerTarget = { revenueTarget: number; callTarget: number; meetingTarget: number };
type Goals = {
  workspaceId: string | null;
  monthlyRevenueTarget: number;
  quarterlyRevenueTarget: number;
  annualRevenueTarget: number;
  monthlyCallTarget: number;
  monthlyMeetingTarget: number;
  pipelineCoverageTarget: number;
  defaultProbability: number;
  staleDealDays: number;
  highValueThreshold: number;
  ownerTargets: Record<string, OwnerTarget>;
  updatedAt?: string | null;
};
type Owner = { id: string; label: string; email?: string | null };

const roleRank = { viewer: 1, admin: 2, owner: 3 };

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value); }
  catch { return `${currency} ${new Intl.NumberFormat('en-US').format(value)}`; }
}

export default function WorkspaceGoalsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [goals, setGoals] = useState<Goals | null>(null);
  const [draft, setDraft] = useState<Goals | null>(null);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canEdit = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);

  const load = useCallback(async (id: string) => {
    setBusy(true);
    setMessage('');
    try {
      const range = new URLSearchParams({ from: new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
      const [goalsResponse, reportResponse, preferencesResponse] = await Promise.all([
        fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/goals`, { cache: 'no-store' }),
        fetch(`/api/dashboard/${encodeURIComponent(id)}/reports?${range}`, { cache: 'no-store' }),
        fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/preferences`, { cache: 'no-store' })
      ]);
      const [goalsPayload, reportPayload, preferencesPayload] = await Promise.all([
        goalsResponse.json(), reportResponse.json(), preferencesResponse.json()
      ]);
      if (!goalsResponse.ok) throw new Error(goalsPayload.message || 'Unable to load targets.');
      if (!reportResponse.ok) throw new Error(reportPayload.message || 'Unable to load HubSpot owners.');
      setGoals(goalsPayload);
      setDraft(goalsPayload);
      setOwners(reportPayload.report?.filterOptions?.owners ?? []);
      setCurrency(preferencesPayload.currency || 'USD');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load target settings.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to manage workspace targets.');
        const payload = await response.json();
        const rows = (payload.workspaces ?? []) as Workspace[];
        const requested = new URLSearchParams(window.location.search).get('workspaceId') || '';
        const selected = rows.find((item) => item.id === requested) ?? rows[0] ?? null;
        setWorkspaces(rows);
        setWorkspaceId(selected?.id ?? '');
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId, load]);

  function updateOwner(ownerId: string, field: keyof OwnerTarget, value: number) {
    if (!draft) return;
    const current = draft.ownerTargets[ownerId] || { revenueTarget: 0, callTarget: 0, meetingTarget: 0 };
    setDraft({ ...draft, ownerTargets: { ...draft.ownerTargets, [ownerId]: { ...current, [field]: value } } });
  }

  async function save() {
    if (!draft || !workspaceId || !canEdit || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/goals`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to save targets.');
      setGoals(payload);
      setDraft(payload);
      setMessage('Targets and forecasting rules saved successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save targets.');
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return <main className={styles.shell}><section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>{message || 'Loading target settings…'}</strong></section></main>;

  const targetPreview = draft.monthlyRevenueTarget;
  const ownerTargetCount = Object.values(draft.ownerTargets).filter((target) => target.revenueTarget || target.callTarget || target.meetingTarget).length;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><span>REVENUE PLANNING</span><h1>Targets, quotas & forecast rules</h1><p>Define the commercial plan used by executive forecasting, team attainment and deal-risk scoring.</p></div>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </header>

      {message ? <div className={styles.message}>{message}</div> : null}
      <section className={styles.preview}>
        <div><Target /><span><small>MONTHLY REVENUE TARGET</small><strong>{money(targetPreview, currency)}</strong></span></div>
        <div><Gauge /><span><small>PIPELINE COVERAGE</small><strong>{draft.pipelineCoverageTarget.toFixed(1)}x</strong></span></div>
        <div><UsersRound /><span><small>OWNER QUOTAS</small><strong>{ownerTargetCount}</strong></span></div>
        <div><BarChart3 /><span><small>DEFAULT PROBABILITY</small><strong>{draft.defaultProbability.toFixed(0)}%</strong></span></div>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Revenue targets</h2><p>Used for actual attainment, expected landing and forecast-gap calculations.</p></div><Target /></div>
          <label>Monthly target<input type="number" min="0" step="1000" value={draft.monthlyRevenueTarget} onChange={(event) => setDraft({ ...draft, monthlyRevenueTarget: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <label>Quarterly target<input type="number" min="0" step="1000" value={draft.quarterlyRevenueTarget} onChange={(event) => setDraft({ ...draft, quarterlyRevenueTarget: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <label>Annual target<input type="number" min="0" step="1000" value={draft.annualRevenueTarget} onChange={(event) => setDraft({ ...draft, annualRevenueTarget: numberValue(event.target.value) })} disabled={!canEdit} /></label>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Activity plan</h2><p>Monthly activity targets are prorated to each selected reporting window.</p></div><BarChart3 /></div>
          <label>Monthly call target<input type="number" min="0" step="1" value={draft.monthlyCallTarget} onChange={(event) => setDraft({ ...draft, monthlyCallTarget: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <label>Monthly meeting target<input type="number" min="0" step="1" value={draft.monthlyMeetingTarget} onChange={(event) => setDraft({ ...draft, monthlyMeetingTarget: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <div className={styles.example}><strong>{draft.monthlyCallTarget.toLocaleString()} calls</strong><span>{draft.monthlyMeetingTarget.toLocaleString()} meetings per month</span></div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Forecast model</h2><p>Controls weighted pipeline and the minimum coverage expected by leadership.</p></div><Gauge /></div>
          <label>Pipeline coverage target<input type="number" min="0.1" max="100" step="0.1" value={draft.pipelineCoverageTarget} onChange={(event) => setDraft({ ...draft, pipelineCoverageTarget: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <label>Default deal probability (%)<input type="number" min="0" max="100" step="1" value={draft.defaultProbability} onChange={(event) => setDraft({ ...draft, defaultProbability: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <p className={styles.hint}>HubSpot stage or deal probability is used first. This value is only a safe fallback.</p>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Risk thresholds</h2><p>Tunes the deal-risk score and executive intervention queue.</p></div><AlertTriangle /></div>
          <label>Stale deal threshold (days)<input type="number" min="1" max="365" step="1" value={draft.staleDealDays} onChange={(event) => setDraft({ ...draft, staleDealDays: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <label>High-value threshold<input type="number" min="0" step="1000" value={draft.highValueThreshold} onChange={(event) => setDraft({ ...draft, highValueThreshold: numberValue(event.target.value) })} disabled={!canEdit} /></label>
          <p className={styles.hint}>Set the high-value threshold to 0 to disable value-based risk weighting.</p>
        </section>
      </div>

      <section className={styles.owners}>
        <header><div><span>OWNER-LEVEL QUOTAS</span><h2>Rep targets</h2><p>Optional owner targets override the workspace defaults for leadership reporting.</p></div><UsersRound /></header>
        <div className={styles.ownerTable}>
          <div className={styles.ownerHead}><span>Owner</span><span>Monthly revenue</span><span>Monthly calls</span><span>Monthly meetings</span></div>
          {owners.map((owner) => {
            const target = draft.ownerTargets[owner.id] || { revenueTarget: 0, callTarget: 0, meetingTarget: 0 };
            return <article key={owner.id}><span><i>{owner.label.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</i><div><strong>{owner.label}</strong><small>{owner.email || owner.id}</small></div></span><input type="number" min="0" step="1000" value={target.revenueTarget} onChange={(event) => updateOwner(owner.id, 'revenueTarget', numberValue(event.target.value))} disabled={!canEdit} /><input type="number" min="0" step="1" value={target.callTarget} onChange={(event) => updateOwner(owner.id, 'callTarget', numberValue(event.target.value))} disabled={!canEdit} /><input type="number" min="0" step="1" value={target.meetingTarget} onChange={(event) => updateOwner(owner.id, 'meetingTarget', numberValue(event.target.value))} disabled={!canEdit} /></article>;
          })}
          {owners.length === 0 ? <div className={styles.empty}>No HubSpot owners are available for this workspace.</div> : null}
        </div>
      </section>

      <section className={styles.governance}><CheckCircle2 /><div><strong>Tenant-safe and audited</strong><p>Only workspace admins and owners can change targets. Every update is written to the workspace audit trail.</p></div><span>{workspace?.role || 'viewer'} access</span></section>
      {!canEdit ? <div className={styles.locked}>Viewer access is read-only. Ask a workspace admin or owner to update the plan.</div> : null}
      <footer className={styles.footer}><button onClick={() => setDraft(goals)} disabled={busy || !canEdit}>Reset</button><button className={styles.primary} onClick={() => void save()} disabled={busy || !canEdit}><Save />{busy ? 'Saving…' : 'Save targets'}</button></footer>
    </main>
  );
}
