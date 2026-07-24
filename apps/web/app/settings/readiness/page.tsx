'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, ExternalLink, LoaderCircle, RefreshCw, Rocket, ShieldCheck } from 'lucide-react';
import styles from './readiness.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer'; portalId?: number | null; hubspotStatus?: string | null; lastDiscoveredAt?: string | null };
type Check = { key: string; label: string; state: 'pass' | 'warning' | 'blocked'; detail: string; href?: string };
type Billing = { subscription?: { status?: string; provider?: string }; entitlements?: { access?: string }; liveCheckoutAvailable?: boolean };
type Retention = { configured?: boolean; activeImport?: { id?: string } | null; summary?: Record<string, number> };
type Schedules = { results?: unknown[] };
type Alerts = { rules?: unknown[]; provider?: { configured?: boolean } };

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Request failed with ${response.status}.`);
  return payload as T;
}

function stateFor(condition: boolean, warning = false): Check['state'] {
  return condition ? 'pass' : warning ? 'warning' : 'blocked';
}

export default function ReadinessPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);

  async function load(id: string) {
    setLoading(true);
    setError('');
    try {
      const [billing, retention, schedules, alerts, report] = await Promise.allSettled([
        json<Billing>(`/api/customer/workspaces/${id}/billing`),
        json<Retention>(`/api/customer/workspaces/${id}/retention-budget/report`),
        json<Schedules>(`/api/customer/workspaces/${id}/report-schedules`),
        json<Alerts>(`/api/customer/workspaces/${id}/alerts`),
        json<Record<string, unknown>>(`/api/dashboard/${id}/reports?scope=core`)
      ]);
      const current = workspaces.find((item) => item.id === id);
      const billingValue = billing.status === 'fulfilled' ? billing.value : null;
      const retentionValue = retention.status === 'fulfilled' ? retention.value : null;
      const schedulesValue = schedules.status === 'fulfilled' ? schedules.value : null;
      const alertsValue = alerts.status === 'fulfilled' ? alerts.value : null;
      const reportReady = report.status === 'fulfilled';
      const emailConfigured = Boolean(alertsValue?.provider?.configured);
      const liveBilling = Boolean(billingValue?.liveCheckoutAvailable);
      setChecks([
        { key: 'workspace', label: 'Workspace access', state: stateFor(Boolean(current)), detail: current ? `${current.name} is available with ${current.role} access.` : 'Workspace is unavailable.' },
        { key: 'hubspot', label: 'HubSpot connection', state: stateFor(Boolean(current?.portalId && current?.hubspotStatus === 'connected')), detail: current?.portalId ? `Portal ${current.portalId} is ${current.hubspotStatus || 'unknown'}.` : 'Connect a HubSpot portal.', href: '/onboarding' },
        { key: 'discovery', label: 'CRM discovery', state: stateFor(Boolean(current?.lastDiscoveredAt)), detail: current?.lastDiscoveredAt ? `Latest discovery: ${new Date(current.lastDiscoveredAt).toLocaleString()}.` : 'Run portal discovery and mapping.', href: '/settings/mappings' },
        { key: 'reports', label: 'Dashboard data plane', state: stateFor(reportReady), detail: reportReady ? 'Core reports return successfully.' : 'Core reports are not currently available.', href: '/dashboard' },
        { key: 'subscription', label: 'Plan and entitlements', state: stateFor(billingValue?.entitlements?.access === 'active'), detail: billingValue ? `${billingValue.subscription?.status || 'unknown'} subscription via ${billingValue.subscription?.provider || 'manual'}.` : 'Billing state could not be loaded.', href: '/settings/billing' },
        { key: 'retention', label: 'Retention source of truth', state: stateFor(Boolean(retentionValue?.activeImport), true), detail: retentionValue?.activeImport ? 'An approved Retention Budget import is active.' : 'Upload and approve the customer Budget CSV before treating retention values as final.', href: '/dashboard/retention-budget' },
        { key: 'schedules', label: 'Scheduled reporting', state: stateFor(Boolean(schedulesValue), true), detail: schedulesValue ? `${schedulesValue.results?.length || 0} scheduled report configurations are available.` : 'Scheduled reporting service is unavailable.', href: '/settings/reports' },
        { key: 'alerts', label: 'Operational alert rules', state: stateFor(Boolean(alertsValue), true), detail: alertsValue ? `${alertsValue.rules?.length || 0} alert rules are configured.` : 'Operational alerts could not be loaded.', href: '/settings/alerts' },
        { key: 'email', label: 'Email delivery provider', state: stateFor(emailConfigured, true), detail: emailConfigured ? 'Resend or Postmark delivery is configured.' : 'Configure a verified sender and provider credentials on the production server.' },
        { key: 'payments', label: 'Live payment collection', state: stateFor(liveBilling, true), detail: liveBilling ? 'Live checkout is available.' : 'Plans and usage work in manual/provider-neutral mode until a payment provider is connected.' },
        { key: 'marketplace', label: 'HubSpot Marketplace approval', state: 'warning', detail: 'Public distribution requires account verification, listing submission and HubSpot reviewer approval.', href: '/support' }
      ]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load production readiness.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    json<{ workspaces: Workspace[] }>('/api/customer/auth/session')
      .then((payload) => {
        const rows = payload.workspaces || [];
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((item) => item.id === remembered) || rows[0];
        setWorkspaces(rows);
        setWorkspaceId(selected?.id || '');
      })
      .catch((reason) => { setError(reason.message); setLoading(false); });
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId, workspaces.length]);

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
      <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    </header>
    <section className={styles.hero}>
      <div><span>LAUNCH CONTROL</span><h1>One place to verify every production dependency.</h1><p>Technical readiness, data truth, delivery, billing and external approval boundaries are evaluated without exposing credentials or customer CRM payloads.</p></div>
      <article className={styles.score}><ShieldCheck/><small>READINESS SCORE</small><strong>{loading ? '—' : `${score}%`}</strong><span>{summary.blocked} blockers · {summary.warning} external/warning items</span></article>
    </section>
    {error ? <div className={styles.error}><AlertTriangle size={18}/>{error}</div> : null}
    <section className={styles.actions}><button onClick={() => workspaceId && load(workspaceId)} disabled={loading}>{loading ? <LoaderCircle className={styles.spin}/> : <RefreshCw size={16}/>}Refresh checks</button><Link href="/dashboard">Open dashboard <ExternalLink size={15}/></Link></section>
    <section className={styles.grid}>
      {checks.map((item) => <article key={item.key} className={`${styles.card} ${styles[item.state]}`}>
        <div className={styles.icon}>{item.state === 'pass' ? <CheckCircle2/> : item.state === 'warning' ? <CircleDashed/> : <AlertTriangle/>}</div>
        <div><small>{item.state.toUpperCase()}</small><h2>{item.label}</h2><p>{item.detail}</p>{item.href ? <Link href={item.href}>Resolve or review <ExternalLink size={14}/></Link> : null}</div>
      </article>)}
    </section>
  </main>;
}
