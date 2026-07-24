'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  CreditCard,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound
} from 'lucide-react';

import styles from './billing.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type Plan = {
  code: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  currency: string;
  limits: Record<string, number>;
  features: string[];
};
type BillingState = {
  subscription: {
    planCode: string;
    status: string;
    provider: string;
    trialEndsAt?: string | null;
    currentPeriodEndsAt?: string | null;
    cancelAtPeriodEnd: boolean;
  };
  plan: Plan;
  plans: Plan[];
  usage: Record<string, number | string>;
  entitlements: {
    access: string;
    blockingReason?: string | null;
    quotas: Record<string, { quantity: number; limit: number; unlimited: boolean; remaining: number | null; exceeded: boolean }>;
  };
  liveCheckoutAvailable: boolean;
};

const roleRank = { viewer: 1, admin: 2, owner: 3 };
const LABELS: Record<string, string> = {
  seats: 'Team seats',
  syncedRecords: 'Synchronized CRM records',
  monthlyExports: 'Exports this month',
  scheduledReports: 'Active scheduled reports'
};

function money(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function date(value?: string | null) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
}

function featureLabel(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BillingPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [state, setState] = useState<BillingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaceId, workspaces]);
  const canManage = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);

  async function load(id = workspaceId) {
    if (!id) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/billing`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to load billing state.');
      setState(payload as BillingState);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load billing state.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Sign in to continue.');
        const rows = (payload.workspaces ?? []) as Workspace[];
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((item) => item.id === remembered) ?? rows[0] ?? null;
        setWorkspaces(rows);
        setWorkspaceId(selected?.id ?? '');
      })
      .catch((error) => { setMessage(error.message); setLoading(false); });
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId]);

  async function action(name: 'start-trial' | 'cancel' | 'reactivate' | 'subscription', body?: object) {
    if (!workspaceId || busy) return;
    setBusy(name);
    setMessage('');
    setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/billing/${name}`, {
        method: name === 'subscription' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to update the subscription.');
      setSuccess(name === 'subscription' ? 'Plan updated.' : name === 'start-trial' ? 'Growth trial started.' : name === 'cancel' ? 'Cancellation scheduled.' : 'Subscription reactivated.');
      await load(workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update the subscription.');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/dashboard"><ArrowLeft size={16} />Dashboard</Link>
        <div><CreditCard size={20} /><span><small>OPS SOLUTIONS</small><strong>Plans & Usage</strong></span></div>
        <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </header>

      <section className={styles.hero}>
        <div><span>COMMERCIAL READINESS</span><h1>Subscription lifecycle and usage are now measurable.</h1><p>Provider-neutral plan controls are active. Existing managed customers stay uninterrupted, while trials, manual plans and usage quotas are ready before a live payment provider is connected.</p></div>
        <div className={styles.statusCard}>{loading ? <LoaderCircle className={styles.spin} /> : <ShieldCheck />}<small>CURRENT STATUS</small><strong>{state?.subscription.status.replaceAll('_', ' ') || 'Loading'}</strong><span>{state?.plan.name || '—'} plan</span></div>
      </section>

      {message ? <div className={styles.error}><AlertTriangle size={17} />{message}</div> : null}
      {success ? <div className={styles.success}><CheckCircle2 size={17} />{success}</div> : null}

      {state ? (
        <>
          <section className={styles.summary}>
            <article><Sparkles /><div><small>PLAN</small><strong>{state.plan.name}</strong><span>{state.subscription.provider} administration</span></div></article>
            <article><Gauge /><div><small>ACCESS</small><strong>{state.entitlements.access}</strong><span>{state.entitlements.blockingReason || 'All enabled features remain available'}</span></div></article>
            <article><UsersRound /><div><small>PERIOD END</small><strong>{date(state.subscription.currentPeriodEndsAt)}</strong><span>{state.subscription.cancelAtPeriodEnd ? 'Cancellation scheduled' : 'Renews or remains managed'}</span></div></article>
          </section>

          <section className={styles.usage}>
            <header><div><span>LIVE ENTITLEMENTS</span><h2>Current usage</h2></div><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? styles.spin : ''} />Refresh</button></header>
            <div>{Object.entries(state.entitlements.quotas).map(([key, quota]) => {
              const percent = quota.unlimited ? 0 : Math.min(100, quota.limit ? quota.quantity / quota.limit * 100 : 0);
              return <article key={key} className={quota.exceeded ? styles.exceeded : ''}><div><strong>{LABELS[key] || featureLabel(key)}</strong><span>{quota.unlimited ? `${quota.quantity} · unlimited` : `${quota.quantity} of ${quota.limit}`}</span></div><i><b style={{ width: `${percent}%` }} /></i><small>{quota.unlimited ? 'No contract limit' : `${quota.remaining ?? 0} remaining`}</small></article>;
            })}</div>
          </section>

          <section className={styles.plans}>
            <header><span>PLAN CATALOG</span><h2>Choose the operating envelope</h2><p>Changes remain manual until a live checkout provider is configured, preventing accidental charges.</p></header>
            <div>{state.plans.map((plan) => <article key={plan.code} className={state.subscription.planCode === plan.code ? styles.current : ''}>
              <div className={styles.planHead}><span>{state.subscription.planCode === plan.code ? 'Current plan' : plan.code.toUpperCase()}</span><h3>{plan.name}</h3><strong>{plan.monthlyPriceCents ? `${money(plan.monthlyPriceCents, plan.currency)} / month` : 'Contract managed'}</strong><p>{plan.description}</p></div>
              <ul>{Object.entries(plan.limits).map(([key, value]) => <li key={key}><Check size={14} />{LABELS[key] || featureLabel(key)}: {value === 0 ? 'Unlimited' : new Intl.NumberFormat('en').format(value)}</li>)}</ul>
              <div className={styles.features}>{plan.features.slice(0, 5).map((feature) => <span key={feature}>{featureLabel(feature)}</span>)}</div>
              <button type="button" disabled={!canManage || Boolean(busy) || state.subscription.planCode === plan.code} onClick={() => void action('subscription', { planCode: plan.code })}>{busy === 'subscription' ? <LoaderCircle className={styles.spin} /> : null}{state.subscription.planCode === plan.code ? 'Selected' : 'Apply manual plan'}</button>
            </article>)}</div>
          </section>

          <section className={styles.actions}>
            <div><h2>Lifecycle controls</h2><p>Start a one-time Growth trial, schedule cancellation, or restore access. Live card charging is intentionally unavailable until provider credentials and webhook verification are configured.</p></div>
            <div>{!state.subscription.trialEndsAt && state.subscription.status === 'managed' ? <button disabled={!canManage || Boolean(busy)} onClick={() => void action('start-trial')}><Sparkles />Start 14-day trial</button> : null}{state.subscription.cancelAtPeriodEnd ? <button disabled={!canManage || Boolean(busy)} onClick={() => void action('reactivate')}><RefreshCw />Reactivate</button> : <button className={styles.danger} disabled={!canManage || Boolean(busy)} onClick={() => void action('cancel')}><AlertTriangle />Schedule cancellation</button>}</div>
          </section>
        </>
      ) : null}
    </main>
  );
}
