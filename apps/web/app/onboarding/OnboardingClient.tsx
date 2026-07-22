'use client';

import { useEffect, useMemo, useState, useTransition, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, Building2, CheckCircle2, Database, LoaderCircle, LockKeyhole, Sparkles } from 'lucide-react';

import './onboarding.css';

type StatusPayload = {
  workspace?: { id: string; name: string };
  hubspot?: { portalId?: number; status?: string } | null;
  discovery?: { status?: string } | null;
  propertyCounts?: Array<{ object_type: string; count: number }>;
  pendingSuggestions?: number;
  sync?: {
    activeRun?: { status?: string; mode?: string } | null;
    latestRun?: { status?: string; mode?: string; error?: string } | null;
    recordCounts?: Array<{ object_type: string; count: number }>;
    freshness?: { total_records?: number } | null;
  };
  ready?: boolean;
  message?: string;
};

const steps = [
  ['Workspace created', 'Your company gets an isolated reporting environment.'],
  ['HubSpot connected', 'OAuth tokens are encrypted and kept server-side.'],
  ['CRM structure discovered', 'Properties, owners and pipelines are analyzed.'],
  ['Historical data synchronized', 'Contacts, companies, deals and activities are prepared.'],
  ['Dashboard generated', 'Your live SDR intelligence workspace is ready.']
];

function totalRecords(status: StatusPayload | null) {
  return Number(status?.sync?.freshness?.total_records ?? 0);
}

export default function OnboardingClient() {
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [phase, setPhase] = useState<'form' | 'redirecting' | 'processing' | 'ready'>('form');
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const completedSteps = useMemo(() => {
    if (phase === 'form') return 0;
    if (phase === 'redirecting') return 1;
    let value = 2;
    if (status?.discovery?.status === 'completed') value = 3;
    if (totalRecords(status) > 0 || status?.sync?.activeRun || status?.sync?.latestRun) value = 4;
    if (status?.ready) value = 5;
    return value;
  }, [phase, status]);

  async function refreshStatus() {
    const response = await fetch('/api/onboarding/status', { cache: 'no-store' });
    const payload = await response.json() as StatusPayload;
    if (!response.ok) throw new Error(payload.message || 'Unable to read onboarding status.');
    setStatus(payload);
    if (payload.ready) setPhase('ready');
    return payload;
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const connected = query.get('connected') === '1' || query.get('hubspot') === 'connected';
    const id = query.get('workspaceId') || '';
    if (!connected || !id) return;

    setWorkspaceId(id);
    setPhase('processing');
    window.history.replaceState({}, '', '/onboarding');

    startTransition(async () => {
      try {
        const response = await fetch('/api/onboarding/complete', { method: 'POST' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to prepare this HubSpot portal.');
        await refreshStatus();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to complete onboarding.');
      }
    });
  }, []);

  useEffect(() => {
    if (phase !== 'processing') return;
    const timer = window.setInterval(() => {
      refreshStatus().catch((error) => setMessage(error.message));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function begin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    startTransition(async () => {
      try {
        const response = await fetch('/api/onboarding/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ companyName, email })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to start onboarding.');
        setWorkspaceId(payload.workspace.id);
        setPhase('redirecting');
        window.location.assign(payload.authorizationUrl);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Unable to start onboarding.');
      }
    });
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-copy">
        <div className="onboarding-brand"><span>OI</span><div><strong>Ops Intelligence</strong><small>HubSpot revenue command center</small></div></div>
        <span className="onboarding-eyebrow"><Sparkles size={14} /> AUTOMATED CRM INTELLIGENCE</span>
        <h1>Connect HubSpot.<br />See the whole operation.</h1>
        <p>Turn your live CRM into a polished SDR, pipeline and execution command center without spreadsheets or manual report building.</p>
        <div className="onboarding-trust">
          <span><LockKeyhole size={16} /> Read-only OAuth</span>
          <span><Database size={16} /> Tenant-isolated data</span>
          <span><BadgeCheck size={16} /> Encrypted credentials</span>
        </div>
      </section>

      <section className="onboarding-card">
        {phase === 'form' ? (
          <>
            <span className="onboarding-step-label">START YOUR WORKSPACE</span>
            <h2>Build your dashboard</h2>
            <p>Enter your company details, then approve the secure HubSpot connection.</p>
            <form onSubmit={begin}>
              <label><span>Company name</span><div><Building2 size={17} /><input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Acme Technologies" minLength={2} maxLength={120} required /></div></label>
              <label><span>Work email</span><div><BadgeCheck size={17} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></div></label>
              <button disabled={isPending}>{isPending ? <><LoaderCircle className="spin" size={18} />Creating workspace…</> : <>Connect HubSpot <ArrowRight size={18} /></>}</button>
            </form>
          </>
        ) : (
          <>
            <span className="onboarding-step-label">WORKSPACE SETUP</span>
            <h2>{phase === 'ready' ? 'Your command center is ready.' : 'We are building your workspace.'}</h2>
            <p>{phase === 'ready' ? `${status?.workspace?.name || 'Your company'} is connected and synchronized.` : 'You can keep this page open while we analyze the CRM and prepare the reporting model.'}</p>
            <div className="onboarding-progress">
              {steps.map(([title, detail], index) => {
                const complete = index < completedSteps;
                const active = index === completedSteps && phase !== 'ready';
                return <article key={title} className={complete ? 'complete' : active ? 'active' : ''}><span>{complete ? <CheckCircle2 size={18} /> : active ? <LoaderCircle className="spin" size={18} /> : index + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></article>;
              })}
            </div>
            {phase === 'ready' ? <a className="onboarding-open" href={`/dashboard?workspaceId=${workspaceId}`}>Open your dashboard <ArrowRight size={18} /></a> : null}
            {phase === 'processing' ? <div className="onboarding-count"><strong>{totalRecords(status).toLocaleString()}</strong><span>CRM records prepared</span></div> : null}
          </>
        )}
        {message ? <div className="onboarding-error">{message}</div> : null}
      </section>
    </main>
  );
}
