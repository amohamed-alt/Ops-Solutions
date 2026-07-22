'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  CheckCircle2,
  CircleUserRound,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  Plus,
  ScanSearch,
  Sparkles,
  X
} from 'lucide-react';

import './onboarding.css';

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
  connected?: boolean;
  discovered?: boolean;
  syncing?: boolean;
  ready?: boolean;
  totalRecords?: number;
  approvedMappings?: number;
  pendingSuggestions?: number;
  propertyCounts?: Array<{ object_type: string; count: number }>;
  latestRun?: { status?: string; error?: string } | null;
  steps?: Array<{ key: string; label: string; status: 'complete' | 'active' | 'waiting' }>;
  message?: string;
};

const defaultSteps = [
  ['Account secured', 'Your login and company workspace are protected.'],
  ['HubSpot connected', 'OAuth tokens are encrypted and kept server-side.'],
  ['CRM structure discovered', 'Properties, owners and pipelines are analyzed.'],
  ['Business fields mapped', 'High-confidence CRM fields are configured automatically.'],
  ['Historical data synchronized', 'Contacts, companies, deals and activities are prepared.'],
  ['Dashboard generated', 'Your live command center is ready.']
];

function workspaceQuery(workspaceId: string) {
  return workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
}

export default function OnboardingClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connectedCallback = searchParams.get('hubspot') === 'connected' || searchParams.get('connected') === '1';
  const callbackWorkspaceId = searchParams.get('workspaceId') ?? '';
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(searchParams.get('workspaceId') ?? '');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [signup, setSignup] = useState({ name: '', companyName: '', email: '', password: '' });
  const [login, setLogin] = useState({ email: '', password: '' });
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const buildStarted = useRef(false);

  const workspace = useMemo(() => {
    const rows = session?.workspaces ?? [];
    return rows.find((item) => item.id === selectedWorkspaceId) ?? rows[0];
  }, [session?.workspaces, selectedWorkspaceId]);
  const activeWorkspaceId = workspace?.id ?? '';
  const connected = Boolean(status?.connected || workspace?.hubspotStatus === 'connected');

  const loadSession = useCallback(async (preferredWorkspaceId = selectedWorkspaceId) => {
    const response = await fetch('/api/customer/auth/session', { cache: 'no-store' });
    if (!response.ok) {
      const empty = { authenticated: false };
      setSession(empty);
      return empty;
    }
    const payload = await response.json() as SessionPayload;
    setSession(payload);
    const rows = payload.workspaces ?? [];
    const preferred = rows.find((item) => item.id === preferredWorkspaceId) ?? rows[0];
    if (preferred && preferred.id !== selectedWorkspaceId) setSelectedWorkspaceId(preferred.id);
    return payload;
  }, [selectedWorkspaceId]);

  const refreshStatus = useCallback(async (workspaceId = activeWorkspaceId) => {
    if (!workspaceId) return null;
    const response = await fetch(`/api/customer/onboarding/status${workspaceQuery(workspaceId)}`, { cache: 'no-store' });
    const payload = await response.json() as StatusPayload;
    if (!response.ok) throw new Error(payload.message || 'Unable to read onboarding status.');
    setStatus(payload);
    return payload;
  }, [activeWorkspaceId]);

  useEffect(() => {
    loadSession().catch((error) => setMessage(error.message));
  }, [loadSession]);

  useEffect(() => {
    if (!session?.authenticated || !activeWorkspaceId) return;
    setStatus(null);
    refreshStatus(activeWorkspaceId).catch((error) => setMessage(error.message));
  }, [session?.authenticated, activeWorkspaceId, refreshStatus]);

  useEffect(() => {
    if (!session?.authenticated || !activeWorkspaceId || !connectedCallback || callbackWorkspaceId !== activeWorkspaceId || buildStarted.current) return;
    buildStarted.current = true;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/customer/onboarding/run${workspaceQuery(activeWorkspaceId)}`, { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to prepare this HubSpot portal.');
        window.history.replaceState({}, '', `/onboarding${workspaceQuery(activeWorkspaceId)}`);
        await refreshStatus(activeWorkspaceId);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to complete onboarding.');
      }
    });
  }, [session?.authenticated, activeWorkspaceId, connectedCallback, callbackWorkspaceId, refreshStatus]);

  useEffect(() => {
    if (!session?.authenticated || !activeWorkspaceId || !connected || status?.ready) return;
    const timer = window.setInterval(() => {
      refreshStatus(activeWorkspaceId).catch((error) => setMessage(error.message));
    }, 3500);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, activeWorkspaceId, connected, status?.ready, refreshStatus]);

  useEffect(() => {
    if (!status?.ready) return;
    const timer = window.setTimeout(() => router.push('/dashboard'), 1800);
    return () => window.clearTimeout(timer);
  }, [status?.ready, router]);

  const completedSteps = useMemo(() => {
    if (!session?.authenticated) return 0;
    if (!connected) return 1;
    if (!status?.discovered) return 2;
    if (!status?.approvedMappings) return 3;
    if (!status?.totalRecords) return 4;
    if (!status?.ready) return 5;
    return 6;
  }, [session?.authenticated, connected, status]);

  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/customer/auth/signup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(signup)
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to create your account.');
        await loadSession();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to create your account.');
      }
    });
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/customer/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(login)
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to sign in.');
        await loadSession();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to sign in.');
      }
    });
  }

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCompanyName.trim();
    if (name.length < 2) {
      setMessage('Enter a company name of at least two characters.');
      return;
    }
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/customer/workspaces', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const payload = await response.json();
        if (!response.ok || !payload.workspace?.id) throw new Error(payload.message || 'Unable to create company workspace.');
        const workspaceId = String(payload.workspace.id);
        buildStarted.current = false;
        setStatus(null);
        setNewCompanyName('');
        setCreatingCompany(false);
        setSelectedWorkspaceId(workspaceId);
        await loadSession(workspaceId);
        window.history.replaceState({}, '', `/onboarding${workspaceQuery(workspaceId)}`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to create company workspace.');
      }
    });
  }

  function selectWorkspace(workspaceId: string) {
    if (!workspaceId || workspaceId === activeWorkspaceId) return;
    buildStarted.current = false;
    setMessage('');
    setStatus(null);
    setSelectedWorkspaceId(workspaceId);
    window.history.replaceState({}, '', `/onboarding${workspaceQuery(workspaceId)}`);
  }

  function connectHubSpot() {
    if (!activeWorkspaceId) return;
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch(`/api/customer/hubspot/start${workspaceQuery(activeWorkspaceId)}`, { method: 'POST' });
        const payload = await response.json();
        if (!response.ok || !payload.authorizationUrl) throw new Error(payload.message || 'Unable to start HubSpot connection.');
        window.location.assign(payload.authorizationUrl);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to start HubSpot connection.');
      }
    });
  }

  function restartBuild() {
    if (!activeWorkspaceId) return;
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch(`/api/customer/onboarding/run${workspaceQuery(activeWorkspaceId)}`, { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to build dashboard.');
        await refreshStatus(activeWorkspaceId);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to build dashboard.');
      }
    });
  }

  if (session === null) {
    return <main className="onboarding-loading"><LoaderCircle className="spin" size={32} /><span>Opening your secure workspace…</span></main>;
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-copy">
        <div className="onboarding-brand"><span>OI</span><div><strong>Ops Intelligence</strong><small>HubSpot revenue command center</small></div></div>
        <span className="onboarding-eyebrow"><Sparkles size={14} /> AUTOMATED CRM INTELLIGENCE</span>
        <h1>Connect HubSpot.<br />See the whole operation.</h1>
        <p>Turn your live CRM into polished executive reporting, SDR execution, pipeline health and action-ready drill-downs without manually building reports.</p>
        <div className="onboarding-trust">
          <span><LockKeyhole size={16} /> Secure customer login</span>
          <span><Database size={16} /> Tenant-isolated data</span>
          <span><BadgeCheck size={16} /> Encrypted OAuth tokens</span>
        </div>
      </section>

      <section className="onboarding-card">
        {!session.authenticated ? (
          <>
            <div className="onboarding-auth-tabs">
              <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Create account</button>
              <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Sign in</button>
            </div>
            <span className="onboarding-step-label">{mode === 'signup' ? 'START YOUR COMPANY WORKSPACE' : 'WELCOME BACK'}</span>
            <h2>{mode === 'signup' ? 'Build your command center' : 'Open your workspace'}</h2>
            <p>{mode === 'signup' ? 'Create your account first. Your company workspace and dashboard access stay private to your team.' : 'Sign in to continue connecting or open your live dashboards.'}</p>
            {mode === 'signup' ? (
              <form onSubmit={signUp}>
                <label><span>Your name</span><div><CircleUserRound size={17} /><input value={signup.name} onChange={(event) => setSignup({ ...signup, name: event.target.value })} placeholder="Abdullah Mohamed" autoComplete="name" minLength={2} required /></div></label>
                <label><span>Company name</span><div><Building2 size={17} /><input value={signup.companyName} onChange={(event) => setSignup({ ...signup, companyName: event.target.value })} placeholder="Acme Technologies" autoComplete="organization" minLength={2} maxLength={120} required /></div></label>
                <label><span>Work email</span><div><BadgeCheck size={17} /><input type="email" value={signup.email} onChange={(event) => setSignup({ ...signup, email: event.target.value })} placeholder="you@company.com" autoComplete="email" required /></div></label>
                <label><span>Password</span><div><KeyRound size={17} /><input type="password" value={signup.password} onChange={(event) => setSignup({ ...signup, password: event.target.value })} placeholder="At least 10 characters" autoComplete="new-password" minLength={10} required /></div></label>
                <button disabled={isPending}>{isPending ? <><LoaderCircle className="spin" size={18} />Creating workspace…</> : <>Create my workspace <ArrowRight size={18} /></>}</button>
              </form>
            ) : (
              <form onSubmit={signIn}>
                <label><span>Work email</span><div><BadgeCheck size={17} /><input type="email" value={login.email} onChange={(event) => setLogin({ ...login, email: event.target.value })} placeholder="you@company.com" autoComplete="email" required /></div></label>
                <label><span>Password</span><div><KeyRound size={17} /><input type="password" value={login.password} onChange={(event) => setLogin({ ...login, password: event.target.value })} placeholder="Your password" autoComplete="current-password" required /></div></label>
                <button disabled={isPending}>{isPending ? <><LoaderCircle className="spin" size={18} />Signing in…</> : <>Open my workspace <ArrowRight size={18} /></>}</button>
              </form>
            )}
          </>
        ) : (
          <>
            <div className="onboarding-workspace-actions">
              <label className="onboarding-workspace-picker">
                <span>Company workspace</span>
                <div><Building2 size={17} /><select value={activeWorkspaceId} onChange={(event) => selectWorkspace(event.target.value)} disabled={isPending}>{session.workspaces?.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select></div>
              </label>
              <button type="button" className="onboarding-add-company" onClick={() => setCreatingCompany((value) => !value)} disabled={isPending}>{creatingCompany ? <X size={16} /> : <Plus size={16} />}{creatingCompany ? 'Cancel' : 'Add company'}</button>
            </div>
            {creatingCompany ? (
              <form className="onboarding-new-company" onSubmit={createCompany}>
                <label><span>New company name</span><div><Building2 size={17} /><input value={newCompanyName} onChange={(event) => setNewCompanyName(event.target.value)} placeholder="Another company" minLength={2} maxLength={120} autoFocus required /></div></label>
                <button disabled={isPending}>{isPending ? <><LoaderCircle className="spin" size={18} />Creating…</> : <>Create workspace <ArrowRight size={18} /></>}</button>
              </form>
            ) : null}
            {!connected ? (
              <>
                <span className="onboarding-step-label">STEP 2 OF 6</span>
                <h2>Connect {workspace?.name || 'your company'} to HubSpot</h2>
                <p>Approve the read-only permissions. We will discover your CRM structure, map the important business fields and build the dashboard automatically.</p>
                <div className="onboarding-connect-visual"><PlugZap size={30} /><span>HubSpot OAuth</span></div>
                <button className="onboarding-primary" onClick={connectHubSpot} disabled={isPending}>{isPending ? <><LoaderCircle className="spin" size={18} />Opening HubSpot…</> : <>Connect HubSpot <ArrowRight size={18} /></>}</button>
                <div className="onboarding-permissions"><span>Contacts & companies</span><span>Deals & pipelines</span><span>Calls, meetings & tasks</span><span>Owners & properties</span></div>
              </>
            ) : (
              <>
                <span className="onboarding-step-label">{status?.ready ? 'YOUR WORKSPACE IS READY' : 'BUILDING YOUR REVENUE COMMAND CENTER'}</span>
                <h2>{status?.ready ? `${workspace?.name || 'Your company'} is ready.` : `Understanding ${workspace?.name || 'your business'}…`}</h2>
                <p>{status?.ready ? `${Number(status.totalRecords || 0).toLocaleString()} HubSpot records are ready for live reporting.` : 'Keep this page open while we analyze this portal and prepare its isolated reporting model.'}</p>
                <div className="onboarding-progress">
                  {defaultSteps.map(([title, detail], index) => {
                    const complete = index < completedSteps;
                    const active = index === completedSteps && !status?.ready;
                    return <article key={title} className={complete ? 'complete' : active ? 'active' : ''}><span>{complete ? <CheckCircle2 size={18} /> : active ? <LoaderCircle className="spin" size={18} /> : index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></article>;
                  })}
                </div>
                <div className="onboarding-live-counts">
                  <article><strong>{(status?.propertyCounts || []).reduce((sum, row) => sum + Number(row.count || 0), 0).toLocaleString()}</strong><span>CRM properties</span></article>
                  <article><strong>{Number(status?.approvedMappings || 0).toLocaleString()}</strong><span>Fields mapped</span></article>
                  <article><strong>{Number(status?.totalRecords || 0).toLocaleString()}</strong><span>Records synced</span></article>
                </div>
                {status?.ready ? <button className="onboarding-primary" onClick={() => router.push('/dashboard')}><BarChart3 size={18} />Open my dashboard <ArrowRight size={18} /></button> : !status?.syncing && !isPending ? <button className="onboarding-primary" onClick={restartBuild}><ScanSearch size={18} />Build this dashboard <ArrowRight size={18} /></button> : <div className="onboarding-building"><LoaderCircle className="spin" size={18} />Building securely in the background…</div>}
              </>
            )}
          </>
        )}
        {message ? <div className="onboarding-error">{message}</div> : null}
      </section>
    </main>
  );
}
