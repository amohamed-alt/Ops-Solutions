'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, LoaderCircle, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import styles from './readiness.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer'; portalId?: number | null; hubspotStatus?: string | null; lastDiscoveredAt?: string | null };
type Check = { key: string; label: string; state: 'pass' | 'warning' | 'blocked'; detail: string; href?: string };
type Billing = { subscription?: { status?: string; provider?: string }; entitlements?: { access?: string }; liveCheckoutAvailable?: boolean };
type Retention = { configured?: boolean; activeImport?: { id?: string } | null };
type Schedules = { results?: unknown[] };
type Alerts = { rules?: unknown[]; provider?: { configured?: boolean } };

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

const REQUEST_TIMEOUT_MS = 12_000;

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Request failed with ${response.status}.`);
  return payload as T;
}

async function settle<T>(url: string, signal: AbortSignal): Promise<Settled<T>> {
  try {
    return { ok: true, value: await json<T>(url, signal) };
  } catch (error) {
    if (signal.aborted) throw error;
    return { ok: false, error: error instanceof Error ? error.message : 'Service unavailable.' };
  }
}

function stateFor(condition: boolean, warning = false): Check['state'] {
  return condition ? 'pass' : warning ? 'warning' : 'blocked';
}

function serviceUnavailable(label: string, error: string, href?: string): Check {
  return {
    key: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_unavailable`,
    label,
    state: 'warning',
    detail: `The service could not be evaluated: ${error}`,
    href
  };
}

export default function ReadinessPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);

  const load = useCallback(async (id: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    setLoading(true);
    setError('');
    try {
      const current = workspaces.find((item) => item.id === id);
      if (!current) throw new Error('The selected company is no longer available to this account.');

      const [billing, retention, schedules, alerts, report] = await Promise.all([
        settle<Billing>(`/api/customer/workspaces/${id}/billing`, controller.signal),
        settle<Retention>(`/api/customer/workspaces/${id}/retention-budget/report`, controller.signal),
        settle<Schedules>(`/api/customer/workspaces/${id}/report-schedules`, controller.signal),
        settle<Alerts>(`/api/customer/workspaces/${id}/alerts`, controller.signal),
        settle<Record<string, unknown>>(`/api/dashboard/${id}/reports?scope=core`, controller.signal)
      ]);
      if (controller.signal.aborted) return;

      const nextChecks: Check[] = [
        { key: 'workspace', label: 'Workspace access', state: 'pass', detail: `${current.name} is available with ${current.role} access.` },
        { key: 'hubspot', label: 'HubSpot connection', state: stateFor(Boolean(current.portalId && current.hubspotStatus === 'connected')), detail: current.portalId ? `Portal ${current.portalId} is ${current.hubspotStatus || 'unknown'}.` : 'Connect a HubSpot portal.', href: '/onboarding' },
        { key: 'discovery', label: 'CRM discovery', state: stateFor(Boolean(current.lastDiscoveredAt)), detail: current.lastDiscoveredAt ? `Latest discovery: ${new Date(current.lastDiscoveredAt).toLocaleString()}.` : 'Run portal discovery and mapping.', href: '/settings/mappings' }
      ];

      nextChecks.push(report.ok
        ? { key: 'reports', label: 'Dashboard data plane', state: 'pass', detail: 'Core reports return successfully.', href: '/dashboard' }
        : serviceUnavailable('Dashboard data plane', report.error, '/dashboard'));

      nextChecks.push(billing.ok
        ? { key: 'subscription', label: 'Plan and entitlements', state: stateFor(billing.value.entitlements?.access === 'active'), detail: `${billing.value.subscription?.status || 'unknown'} subscription via ${billing.value.subscription?.provider || 'manual'}.`, href: '/settings/billing' }
        : serviceUnavailable('Plan and entitlements', billing.error, '/settings/billing'));

      nextChecks.push(retention.ok
        ? { key: 'retention', label: 'Retention source of truth', state: stateFor(Boolean(retention.value.activeImport), true), detail: retention.value.activeImport ? 'An approved Retention Budget import is active.' : 'Upload and approve the customer Budget CSV before treating retention values as final.', href: '/dashboard/retention-budget' }
        : serviceUnavailable('Retention source of truth', retention.error, '/dashboard/retention-budget'));

      nextChecks.push(schedules.ok
        ? { key: 'schedules', label: 'Scheduled reporting', state: 'pass', detail: `${schedules.value.results?.length || 0} scheduled report configurations are available.`, href: '/settings/reports' }
        : serviceUnavailable('Scheduled reporting', schedules.error, '/settings/reports'));

      nextChecks.push(alerts.ok
        ? { key: 'alerts', label: 'Operational alert rules', state: 'pass', detail: `${alerts.value.rules?.length || 0} alert rules are configured.`, href: '/settings/alerts' }
        : serviceUnavailable('Operational alert rules', alerts.error, '/settings/alerts'));

      nextChecks.push(alerts.ok
        ? { key: 'email', label: 'Email delivery provider', state: stateFor(Boolean(alerts.value.provider?.configured), true), detail: alerts.value.provider?.configured ? 'Resend or Postmark delivery is configured.' : 'Configure a verified sender and provider credentials on the production server.' }
        : serviceUnavailable('Email delivery provider', alerts.error));

      nextChecks.push(billing.ok
        ? { key: 'payments', label: 'Live payment collection', state: stateFor(Boolean(billing.value.liveCheckoutAvailable), true), detail: billing.value.liveCheckoutAvailable ? 'Live checkout is available.' : 'Plans and usage work in manual/provider-neutral mode until a payment provider is connected.' }
        : serviceUnavailable('Live payment collection', billing.error, '/settings/billing'));

      nextChecks.push({ key: 'marketplace', label: 'HubSpot Marketplace approval', state: 'warning', detail: 'Public distribution requires account verification, listing submission and HubSpot reviewer approval.', href: '/support' });
      setChecks(nextChecks);
      setGeneratedAt(new Date().toISOString());
      window.localStorage.setItem('ops:last-dashboard-workspace', id);
    } catch (reason) {
      if (controller.signal.aborted) {
        setError('Readiness checks timed out. Retry after confirming the API and reporting services are healthy.');
      } else {
        setError(reason instanceof Error ? reason.message : 'Unable to load production readiness.');
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [workspaces]);

  useEffect(() => {
    const controller = new AbortController();
    json<{ workspaces: Workspace[] }>('/api/customer/auth/session', controller.signal)
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
    if (workspaceId && workspaces.length) void load(workspaceId);
    return () => requestRef.current?.abort();
  }, [workspaceId, workspaces.length, load]);

  const summary = useMemo(() => ({
    pass: checks.filter((item) => item.state === 'pass').length,
    warning: checks.filter((item) => item.state === 'warning').length,
    blocked: checks.filter((item) => item.state === 'blocked').length
  }), [checks]);
  const score = checks.length ? Math.round(((summary.pass + summary.warning * 0.5) / checks.length) * 100) : 0;

  return <main className={styles.shell}>
    <header className={styles.topbar}>
      <Link href="/dashboard"><ArrowLeft size={16}/>Dashboard</Link>
      <div><Rocket size={20}/><span><small>OPS SOLUTIONS</small><strong>Production Readiness</strong></span></div>
      <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={!workspaces.length}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </header>
    <section className={styles.hero}>
      <div><span>LAUNCH CONTROL</span><h1>One place to verify every production dependency.</h1><p>Technical readiness, data truth, delivery, billing and external approval boundaries are evaluated without exposing credentials or customer CRM payloads.</p></div>
      <article className={styles.score}><ShieldCheck/><small>READINESS SCORE</small><strong>{loading ? '—' : `${score}%`}</strong><span>{summary.blocked} blockers · {summary.warning} warning or external items</span>{generatedAt ? <small>Updated {new Date(generatedAt).toLocaleTimeString()}</small> : null}</article>
    </section>
    {error ? <div className={styles.error}><AlertTriangle size={18}/>{error}</div> : null}
    <section className={styles.actions}><button onClick={() => workspaceId && load(workspaceId)} disabled={loading || !workspaceId}>{loading ? <LoaderCircle className={styles.spin}/> : <RefreshCw size={16}/>}Refresh checks</button><Link href="/dashboard">Open dashboard <ExternalLink size={15}/></Link></section>
    {!loading && !workspaces.length ? <div className={styles.error}><AlertTriangle size={18}/>No company workspace is assigned to this account. Ask an owner to invite you or create a workspace during onboarding.</div> : null}
    <section className={styles.grid} aria-busy={loading} aria-live="polite">
      {checks.map((item) => <article key={item.key} className={`${styles.card} ${styles[item.state]}`}>
        <div className={styles.icon}>{item.state === 'pass' ? <CheckCircle2/> : item.state === 'warning' ? <CircleDashed/> : <AlertTriangle/>}</div>
        <div><small>{item.state.toUpperCase()}</small><h2>{item.label}</h2><p>{item.detail}</p>{item.href ? <Link href={item.href}>Resolve or review <ExternalLink size={14}/></Link> : null}</div>
      </article>)}
    </section>
  </main>;
}
