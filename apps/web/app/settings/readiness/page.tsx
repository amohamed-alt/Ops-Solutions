'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Clock3, ExternalLink, History, LoaderCircle, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
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
type HistoryResponse = { results: ReadinessSnapshot[] };

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
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canRecord = workspace?.role === 'owner' || workspace?.role === 'admin';

  const load = useCallback(async (id: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    setLoading(true);
    setError('');

    try {
      const [readiness, snapshots] = await Promise.all([
        json<ReadinessReport>(`/api/customer/workspaces/${id}/onboarding-readiness`, { signal: controller.signal }),
        json<HistoryResponse>(`/api/customer/workspaces/${id}/onboarding-readiness/history?limit=20`, { signal: controller.signal })
      ]);
      if (controller.signal.aborted) return;
      setReport(readiness);
      setHistory(snapshots.results || []);
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
    if (!workspaceId || !canRecord || recording) return;
    setRecording(true);
    setError('');
    try {
      const next = await json<ReadinessReport>(`/api/customer/workspaces/${workspaceId}/onboarding-readiness`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ freshnessHours: report?.policy.freshnessHours ?? 24 })
      });
      setReport(next);
      const snapshots = await json<HistoryResponse>(`/api/customer/workspaces/${workspaceId}/onboarding-readiness/history?limit=20`);
      setHistory(snapshots.results || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to record readiness evaluation.');
    } finally {
      setRecording(false);
    }
  }, [workspaceId, canRecord, recording, report?.policy.freshnessHours]);

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
        {canRecord ? <button className={styles.secondaryButton} onClick={recordEvaluation} disabled={recording || loading}>{recording ? <LoaderCircle className={styles.spin}/> : <History size={16}/>}Record evaluation</button> : null}
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
