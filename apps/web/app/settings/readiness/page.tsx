'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Clock3, ExternalLink, History, Inbox, LoaderCircle, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import styles from './readiness.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type ReadinessCheck = {
  key: string;
  label: string;
  state: 'pass' | 'warning' | 'blocked';
  blocking: boolean;
  detail: string;
  action: string;
  evidence?: Record<string, unknown>;
};
type ReadinessReport = {
  workspace: { id: string; name: string; portalId?: number | null };
  policy: { freshnessHours: number; requiredObjects: string[] };
  summary: { ready: boolean; score: number; pass: number; warning: number; blockers: number; total: number };
  checks: ReadinessCheck[];
  nextActions: Array<{ key: string; label: string; action: string }>;
  generatedAt: string;
  snapshot?: ReadinessSnapshot;
};
type ReadinessSnapshot = {
  id: string;
  ready: boolean;
  score: number;
  blockers: number;
  warnings: number;
  previousReady: boolean | null;
  transitioned: boolean;
  triggerSource: string;
  generatedAt: string;
  createdAt: string;
};
type ReadinessIncident = {
  id: string;
  status: 'open' | 'acknowledged' | 'resolved';
  severity: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  lastNotifiedAt?: string | null;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  note?: string | null;
  occurrences: number;
  score: number;
  blockers: number;
  warnings: number;
  snapshotGeneratedAt: string;
};
type HistoryResponse = { results: ReadinessSnapshot[] };
type IncidentResponse = { results: ReadinessIncident[] };

const REQUEST_TIMEOUT_MS = 12_000;
const CHECK_LINKS: Record<string, string> = {
  workspace_active: '/settings/team',
  hubspot_connected: '/onboarding',
  schema_discovered: '/settings/mappings',
  semantic_mappings: '/settings/mappings',
  initial_sync: '/settings/data-sla',
  data_freshness: '/settings/data-sla',
  workspace_ownership: '/settings/team',
  auditability: '/settings/audit'
};

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Request failed with ${response.status}.`);
  return payload as T;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

export default function ReadinessPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [history, setHistory] = useState<ReadinessSnapshot[]>([]);
  const [incidents, setIncidents] = useState<ReadinessIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [updatingIncidentId, setUpdatingIncidentId] = useState('');
  const [incidentNote, setIncidentNote] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canManage = workspace?.role === 'owner' || workspace?.role === 'admin';

  const load = useCallback(async (id: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setLoading(true);
    setError('');

    try {
      const [readiness, snapshots, incidentRows] = await Promise.all([
        json<ReadinessReport>(`/api/customer/workspaces/${id}/onboarding-readiness`, { signal: controller.signal }),
        json<HistoryResponse>(`/api/customer/workspaces/${id}/onboarding-readiness/history?limit=20`, { signal: controller.signal }),
        json<IncidentResponse>(`/api/customer/workspaces/${id}/readiness-incidents?limit=50`, { signal: controller.signal })
      ]);
      if (controller.signal.aborted) return;
      setReport(readiness);
      setHistory(snapshots.results || []);
      setIncidents(incidentRows.results || []);
      window.localStorage.setItem('ops:last-dashboard-workspace', id);
    } catch (reason) {
      if (controller.signal.aborted) {
        setError('Readiness evaluation timed out. Retry after confirming the API and database are healthy.');
      } else {
        setError(reason instanceof Error ? reason.message : 'Unable to load onboarding readiness.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  const recordEvaluation = useCallback(async () => {
    if (!workspaceId || !canManage || recording) return;
    setRecording(true);
    setError('');
    try {
      const next = await json<ReadinessReport>(`/api/customer/workspaces/${workspaceId}/onboarding-readiness`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ freshnessHours: report?.policy.freshnessHours ?? 24 })
      });
      setReport(next);
      await load(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to record readiness evaluation.');
    } finally {
      setRecording(false);
    }
  }, [workspaceId, canManage, recording, report?.policy.freshnessHours, load]);

  const updateIncident = useCallback(async (incidentId: string, action: 'acknowledge' | 'resolve') => {
    if (!workspaceId || !canManage || updatingIncidentId) return;
    setUpdatingIncidentId(incidentId);
    setError('');
    try {
      await json<ReadinessIncident>(`/api/customer/workspaces/${workspaceId}/readiness-incidents/${incidentId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: incidentNote[incidentId] || '' })
      });
      setIncidentNote((current) => ({ ...current, [incidentId]: '' }));
      await load(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update readiness incident.');
    } finally {
      setUpdatingIncidentId('');
    }
  }, [workspaceId, canManage, updatingIncidentId, incidentNote, load]);

  useEffect(() => {
    const controller = new AbortController();
    json<{ workspaces: Workspace[] }>('/api/customer/auth/session', { signal: controller.signal })
      .then((payload) => {
        const rows = payload.workspaces || [];
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((item) => item.id === remembered) || rows[0];
        setWorkspaces(rows);
        setWorkspaceId(selected?.id || '');
        if (!selected) setLoading(false);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Unable to load workspace access.');
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (workspaceId) void load(workspaceId);
    return () => requestRef.current?.abort();
  }, [workspaceId, load]);

  const summary = report?.summary ?? { ready: false, score: 0, pass: 0, warning: 0, blockers: 0, total: 0 };
  const latestTransition = history.find((item) => item.transitioned);
  const activeIncidents = incidents.filter((item) => item.status !== 'resolved');

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <Link href="/dashboard"><ArrowLeft size={16}/>Dashboard</Link>
      <div><Rocket size={20}/><span><small>OPS SOLUTIONS</small><strong>Onboarding Readiness</strong></span></div>
      <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={!workspaces.length}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </header>

    <section className={styles.hero}>
      <div><span>PRODUCTION GATE</span><h1>One canonical view of every onboarding blocker.</h1><p>HubSpot connection, discovery, mappings, synchronization, freshness, ownership and auditability are evaluated by the tenant-scoped API and preserved as an operational history.</p></div>
      <article className={`${styles.score} ${summary.ready ? styles.ready : styles.notReady}`}>
        <ShieldCheck/><small>READINESS SCORE</small><strong>{loading ? '—' : `${summary.score}%`}</strong>
        <span>{summary.ready ? 'Production ready' : `${summary.blockers} blocker${summary.blockers === 1 ? '' : 's'} remaining`} · {summary.warning} warning{summary.warning === 1 ? '' : 's'}</span>
        {report?.generatedAt ? <small>Live evaluation {formatDate(report.generatedAt)}</small> : null}
      </article>
    </section>

    {error ? <div className={styles.error} role="alert"><AlertTriangle size={18}/>{error}</div> : null}
    {!loading && !workspaces.length ? <div className={styles.error}><AlertTriangle size={18}/>No company workspace is assigned to this account.</div> : null}

    <section className={styles.actions}>
      <div>
        <button onClick={() => workspaceId && load(workspaceId)} disabled={loading || !workspaceId}>{loading ? <LoaderCircle className={styles.spin}/> : <RefreshCw size={16}/>}Refresh live status</button>
        {canManage ? <button className={styles.secondaryButton} onClick={recordEvaluation} disabled={recording || loading}>{recording ? <LoaderCircle className={styles.spin}/> : <History size={16}/>}Record evaluation</button> : null}
      </div>
      <Link href="/dashboard">Open dashboard <ExternalLink size={15}/></Link>
    </section>

    <section className={styles.grid} aria-busy={loading} aria-live="polite">
      {(report?.checks || []).map((item) => <article key={item.key} className={`${styles.card} ${styles[item.state]}`}>
        <div className={styles.icon}>{item.state === 'pass' ? <CheckCircle2/> : item.state === 'warning' ? <CircleDashed/> : <AlertTriangle/>}</div>
        <div><small>{item.state.toUpperCase()}</small><h2>{item.label}</h2><p>{item.detail}</p>{item.state !== 'pass' ? <p className={styles.actionText}>{item.action}</p> : null}{CHECK_LINKS[item.key] ? <Link href={CHECK_LINKS[item.key]}>Resolve or review <ExternalLink size={14}/></Link> : null}</div>
      </article>)}
    </section>

    <section className={styles.historySection}>
      <div className={styles.sectionHeading}><div><small>OPERATIONS INBOX</small><h2>Readiness incidents</h2><p>Durable regressions are visible to the whole workspace and remain open until recovery or an explicit operational resolution.</p></div><span className={styles.incidentCount}>{activeIncidents.length} active</span></div>
      {!incidents.length ? <div className={styles.empty}><Inbox/><div><strong>No readiness incidents</strong><p>This workspace has no recorded production-readiness regression.</p></div></div> : <div className={styles.incidentList}>
        {incidents.map((incident) => <article key={incident.id} className={`${styles.incidentCard} ${styles[`incident_${incident.status}`]}`}>
          <div className={styles.incidentHeader}><div><span>{incident.status.replaceAll('_', ' ').toUpperCase()}</span><h3>{incident.blockers} blockers · score {incident.score}%</h3></div><strong>{incident.occurrences} occurrence{incident.occurrences === 1 ? '' : 's'}</strong></div>
          <p>First detected {formatDate(incident.firstDetectedAt)} · last detected {formatDate(incident.lastDetectedAt)}</p>
          {incident.note ? <blockquote>{incident.note}</blockquote> : null}
          {canManage && incident.status !== 'resolved' ? <div className={styles.incidentActions}>
            <input value={incidentNote[incident.id] || ''} onChange={(event) => setIncidentNote((current) => ({ ...current, [incident.id]: event.target.value }))} placeholder="Optional operational note" maxLength={1000}/>
            {incident.status === 'open' ? <button className={styles.secondaryButton} onClick={() => updateIncident(incident.id, 'acknowledge')} disabled={Boolean(updatingIncidentId)}>{updatingIncidentId === incident.id ? <LoaderCircle className={styles.spin}/> : null}Acknowledge</button> : null}
            <button onClick={() => updateIncident(incident.id, 'resolve')} disabled={Boolean(updatingIncidentId)}>{updatingIncidentId === incident.id ? <LoaderCircle className={styles.spin}/> : null}Resolve</button>
          </div> : null}
        </article>)}
      </div>}
    </section>

    <section className={styles.historySection}>
      <div className={styles.sectionHeading}><div><small>IMMUTABLE HISTORY</small><h2>Readiness timeline</h2><p>Recorded evaluations provide evidence of when a company became ready or returned to a blocked state.</p></div>{latestTransition ? <span className={styles.transitionBadge}>Last transition {formatDate(latestTransition.createdAt)}</span> : null}</div>
      {!history.length ? <div className={styles.empty}><Clock3/><div><strong>No evaluations recorded yet</strong><p>Owners and admins can record the current server-side evaluation to start the timeline.</p></div></div> : <div className={styles.timeline}>
        {history.map((item) => <article key={item.id} className={styles.timelineItem}>
          <span className={`${styles.timelineDot} ${item.ready ? styles.timelineReady : styles.timelineBlocked}`}/>
          <div><strong>{item.ready ? 'Production ready' : 'Blocked'} · {item.score}%</strong><p>{item.blockers} blockers · {item.warnings} warnings · {item.triggerSource.replaceAll('_', ' ')}</p>{item.transitioned ? <em>{item.previousReady ? 'Moved from ready to blocked' : 'Moved from blocked to ready'}</em> : null}</div>
          <time>{formatDate(item.createdAt)}</time>
        </article>)}
      </div>}
    </section>
  </main>;
}
