'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  CircleUserRound,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Orbit,
  PlugZap,
  ScanSearch,
  ShieldCheck,
  Sparkles
} from 'lucide-react';

import styles from './page.module.css';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
  portalId: number | null;
  hubspotStatus: string | null;
};

type SessionPayload = {
  authenticated: boolean;
  user?: { displayName: string; email: string };
  workspaces?: Workspace[];
};

type StatusPayload = {
  connected: boolean;
  discovered: boolean;
  syncing: boolean;
  ready: boolean;
  totalRecords: number;
  approvedMappings: number;
  propertyCounts: Array<{ object_type: string; count: number }>;
  steps: Array<{ key: string; label: string; status: 'complete' | 'active' | 'waiting' }>;
  latestRun?: { status?: string; error?: string } | null;
  message?: string;
};

const emptySignup = { name: '', email: '', companyName: '', password: '' };
const emptyLogin = { email: '', password: '' };

export default function OnboardingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectedCallback = searchParams.get('hubspot') === 'connected' || searchParams.get('connected') === '1';
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [signup, setSignup] = useState(emptySignup);
  const [login, setLogin] = useState(emptyLogin);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const onboardingStarted = useRef(false);

  const loadSession = useCallback(async () => {
    const response = await fetch('/api/customer/auth/session', { cache: 'no-store' });
    if (!response.ok) {
      setSession({ authenticated: false });
      return null;
    }
    const payload = await response.json() as SessionPayload;
    setSession(payload);
    return payload;
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch('/api/customer/onboarding/status', { cache: 'no-store' });
    const payload = await response.json() as StatusPayload;
    if (!response.ok) throw new Error(payload.message ?? 'Unable to read workspace progress.');
    setStatus(payload);
    return payload;
  }, []);

  useEffect(() => {
    loadSession().catch((error) => setMessage(error.message));
  }, [loadSession]);

  useEffect(() => {
    if (!session?.authenticated) return;
    loadStatus().catch((error) => setMessage(error.message));
  }, [session?.authenticated, loadStatus]);

  useEffect(() => {
    if (!session?.authenticated || !connectedCallback || onboardingStarted.current) return;
    onboardingStarted.current = true;
    setBusy(true);
    setMessage('');
    fetch('/api/customer/onboarding/run', { method: 'POST' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message ?? 'Unable to analyze this HubSpot portal.');
        await loadStatus();
      })
      .catch((error) => setMessage(error.message))
      .finally(() => setBusy(false));
  }, [session?.authenticated, connectedCallback, loadStatus]);

  useEffect(() => {
    if (!session?.authenticated || !status || status.ready) return;
    if (!status.connected && !connectedCallback) return;
    const timer = window.setInterval(() => {
      loadStatus().catch((error) => setMessage(error.message));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, status, connectedCallback, loadStatus]);

  useEffect(() => {
    if (!status?.ready) return;
    const timer = window.setTimeout(() => router.push('/dashboard'), 1800);
    return () => window.clearTimeout(timer);
  }, [status?.ready, router]);

  async function submitSignup(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/customer/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(signup)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Unable to create account.');
      await loadSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create account.');
    } finally {
      setBusy(false);
    }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/customer/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(login)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Unable to sign in.');
      await loadSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function connectHubSpot() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/customer/hubspot/start', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.message ?? 'Unable to connect HubSpot.');
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to connect HubSpot.');
      setBusy(false);
    }
  }

  async function startBuild() {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/customer/onboarding/run', { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? 'Unable to build dashboard.');
      await loadStatus();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to build dashboard.');
    } finally {
      setBusy(false);
    }
  }

  if (session === null) {
    return <main className={styles.loadingPage}><LoaderCircle className={styles.spin} size={34} /><span>Opening your workspace…</span></main>;
  }

  if (!session.authenticated) {
    return (
      <main className={styles.authPage}>
        <section className={styles.authStory}>
          <div className={styles.brand}><span>OI</span><div><strong>Ops Intelligence</strong><small>HubSpot command center</small></div></div>
          <div className={styles.storyCopy}>
            <span className={styles.eyebrow}>REVENUE INTELLIGENCE IN MINUTES</span>
            <h1>Connect HubSpot.<br /><em>See what matters.</em></h1>
            <p>One secure connection turns your CRM into executive reporting, SDR execution, pipeline health and action-ready drill-downs.</p>
          </div>
          <div className={styles.storySteps}>
            <article><PlugZap size={18} /><div><strong>Connect once</strong><span>Read-only OAuth with encrypted tokens.</span></div></article>
            <article><ScanSearch size={18} /><div><strong>Automatic intelligence</strong><span>Properties, owners and pipelines are mapped for you.</span></div></article>
            <article><BarChart3 size={18} /><div><strong>Dashboard ready</strong><span>Live charts and records from your own portal.</span></div></article>
          </div>
          <div className={styles.trustRow}><span><ShieldCheck size={14} />Tenant isolated</span><span><LockKeyhole size={14} />Encrypted</span><span><Database size={14} />Live CRM data</span></div>
        </section>

        <section className={styles.authPanel}>
          <div className={styles.modeSwitch}>
            <button className={mode === 'signup' ? styles.active : ''} onClick={() => setMode('signup')}>Create account</button>
            <button className={mode === 'login' ? styles.active : ''} onClick={() => setMode('login')}>Sign in</button>
          </div>
          {mode === 'signup' ? (
            <form onSubmit={submitSignup} className={styles.authForm}>
              <div><span className={styles.formIcon}><CircleUserRound size={18} /></span><input value={signup.name} onChange={(event) => setSignup({ ...signup, name: event.target.value })} placeholder="Your name" autoComplete="name" required /></div>
              <div><span className={styles.formIcon}><Building2 size={18} /></span><input value={signup.companyName} onChange={(event) => setSignup({ ...signup, companyName: event.target.value })} placeholder="Company name" autoComplete="organization" required /></div>
              <div><span className={styles.formIcon}>@</span><input type="email" value={signup.email} onChange={(event) => setSignup({ ...signup, email: event.target.value })} placeholder="Work email" autoComplete="email" required /></div>
              <div><span className={styles.formIcon}><KeyRound size={18} /></span><input type="password" minLength={10} value={signup.password} onChange={(event) => setSignup({ ...signup, password: event.target.value })} placeholder="Password · 10+ characters" autoComplete="new-password" required /></div>
              <button disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={18} /> : <Sparkles size={18} />}{busy ? 'Creating workspace…' : 'Create my workspace'}<ArrowRight size={17} /></button>
            </form>
          ) : (
            <form onSubmit={submitLogin} className={styles.authForm}>
              <div><span className={styles.formIcon}>@</span><input type="email" value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} placeholder="Work email" autoComplete="email" required /></div>
              <div><span className={styles.formIcon}><KeyRound size={18} /></span><input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Password" autoComplete="current-password" required /></div>
              <button disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={18} /> : <LockKeyhole size={18} />}{busy ? 'Signing in…' : 'Open my workspace'}<ArrowRight size={17} /></button>
            </form>
          )}
          {message ? <div className={styles.error}>{message}</div> : null}
          <p className={styles.legal}>By continuing, you confirm you are authorized to connect your company&apos;s HubSpot account.</p>
        </section>
      </main>
    );
  }

  const workspace = session.workspaces?.[0];
  const connected = status?.connected || workspace?.hubspotStatus === 'connected';
  const isBuilding = connected && !status?.ready;

  return (
    <main className={styles.onboardingPage}>
      <header className={styles.onboardingHeader}>
        <div className={styles.brand}><span>{workspace?.name?.slice(0, 1).toUpperCase() || 'O'}</span><div><strong>{workspace?.name || 'Your company'}</strong><small>Revenue intelligence setup</small></div></div>
        <div className={styles.account}><span>{session.user?.displayName}</span><small>{session.user?.email}</small></div>
      </header>

      <section className={styles.onboardingBody}>
        <div className={styles.progressRail}>
          {(status?.steps ?? [
            { key: 'account', label: 'Account secured', status: 'complete' },
            { key: 'hubspot', label: 'HubSpot connected', status: connected ? 'complete' : 'active' },
            { key: 'schema', label: 'CRM structure analyzed', status: 'waiting' },
            { key: 'mapping', label: 'Business fields mapped', status: 'waiting' },
            { key: 'sync', label: 'Revenue data synchronized', status: 'waiting' },
            { key: 'dashboard', label: 'Dashboard ready', status: 'waiting' }
          ]).map((step, index) => (
            <article key={step.key} className={`${styles.progressStep} ${styles[step.status]}`}>
              <span>{step.status === 'complete' ? <Check size={16} /> : step.status === 'active' ? <LoaderCircle className={styles.spin} size={16} /> : index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.status === 'complete' ? 'Complete' : step.status === 'active' ? 'Working now' : 'Up next'}</small></div>
            </article>
          ))}
        </div>

        {!connected ? (
          <section className={styles.connectCard}>
            <div className={styles.hubspotOrb}><Orbit size={42} /><i /><i /><i /></div>
            <span className={styles.eyebrow}>STEP 2 OF 6</span>
            <h1>Connect your HubSpot portal</h1>
            <p>Approve read-only access so Ops Intelligence can understand your CRM structure and build reports around the way your company actually works.</p>
            <button onClick={connectHubSpot} disabled={busy}>{busy ? <LoaderCircle className={styles.spin} size={19} /> : <PlugZap size={19} />}{busy ? 'Opening HubSpot…' : 'Connect HubSpot'}<ArrowRight size={18} /></button>
            <div className={styles.permissionGrid}>
              <span><Check size={14} />Contacts & companies</span><span><Check size={14} />Deals & pipelines</span><span><Check size={14} />Calls, meetings & tasks</span><span><Check size={14} />Owners & custom properties</span>
            </div>
          </section>
        ) : (
          <section className={styles.scanCard}>
            <div className={`${styles.scanner} ${status?.ready ? styles.scannerReady : ''}`}>
              <div><Database size={34} /><span>{status?.ready ? <BadgeCheck size={24} /> : <ScanSearch size={24} />}</span></div>
              <i /><i /><i />
            </div>
            <span className={styles.eyebrow}>{status?.ready ? 'YOUR WORKSPACE IS READY' : 'BUILDING YOUR REVENUE COMMAND CENTER'}</span>
            <h1>{status?.ready ? 'Your dashboards are ready.' : 'Understanding your business…'}</h1>
            <p>{status?.ready ? `${status.totalRecords.toLocaleString()} HubSpot records are ready for live reporting.` : 'We are analyzing properties, owners, pipelines, activities and associations, then generating the reporting model automatically.'}</p>

            <div className={styles.liveStats}>
              <article><strong>{status?.propertyCounts?.reduce((sum, item) => sum + Number(item.count || 0), 0).toLocaleString() || '—'}</strong><span>CRM properties</span></article>
              <article><strong>{status?.approvedMappings?.toLocaleString() || '—'}</strong><span>Fields mapped</span></article>
              <article><strong>{status?.totalRecords?.toLocaleString() || '—'}</strong><span>Records synced</span></article>
            </div>

            {status?.ready ? (
              <button onClick={() => router.push('/dashboard')}><BarChart3 size={19} />Open my dashboard<ArrowRight size={18} /></button>
            ) : !status?.syncing && !busy ? (
              <button onClick={startBuild}><Sparkles size={19} />Build my dashboard<ArrowRight size={18} /></button>
            ) : (
              <div className={styles.buildingState}><LoaderCircle className={styles.spin} size={19} /><span>Building securely in the background. You can keep this page open.</span></div>
            )}
          </section>
        )}
        {message ? <div className={styles.error}>{message}</div> : null}
      </section>
    </main>
  );
}
