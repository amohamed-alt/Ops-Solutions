'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, KeyRound, Laptop, LoaderCircle, LogOut, RefreshCw, ShieldAlert, ShieldCheck, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './security.module.css';

type SessionRisk = {
  level: 'trusted' | 'normal' | 'review' | 'high';
  reason: string;
  dormantDays: number;
  familiarDevice: boolean;
  explicitlyTrusted: boolean;
};
type Session = {
  id: string;
  current: boolean;
  client: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  familiarDevice: boolean;
  explicitlyTrusted: boolean;
  risk: SessionRisk;
};

type SecurityEvent = {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type SecurityPayload = {
  sessions: Session[];
  summary: { active: number; needsReview: number; highRisk: number; unfamiliarDevices: number; trustedDevices: number };
  events: SecurityEvent[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    'session.revoked': 'A session was revoked',
    'sessions.revoked_others': 'Other sessions were revoked',
    'sessions.revoked_stale': 'Dormant sessions were cleaned up',
    'device.trusted': 'A device was marked as trusted',
    'password.reset_completed': 'Password was reset',
    'password.reset_requested': 'Password recovery was requested',
    'password.reset_delivery_failed': 'Password recovery email failed'
  };
  return labels[action] || action.replaceAll('.', ' ');
}

function riskLabel(risk: SessionRisk) {
  if (risk.level === 'trusted') return 'Trusted';
  if (risk.level === 'high') return 'High risk';
  if (risk.level === 'review') return 'Review';
  return 'Normal';
}

export default function AccountSecurityPage() {
  const [data, setData] = useState<SecurityPayload | null>(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy('refresh');
    setError('');
    try {
      const response = await fetch('/api/customer/security', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to load account security.');
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load account security.');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const otherSessions = useMemo(() => data?.sessions.filter((session) => !session.current) ?? [], [data]);

  async function trustCurrentDevice() {
    if (busy) return;
    setBusy('trust-current');
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/customer/security', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'trust_current_device' })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to trust this device.');
      setMessage('This device is now trusted for future sign-ins.');
      await load();
    } catch (trustError) {
      setError(trustError instanceof Error ? trustError.message : 'Unable to trust this device.');
      setBusy('');
    }
  }

  async function revoke(action: 'revoke_session' | 'revoke_others' | 'revoke_stale', sessionId?: string) {
    if (busy) return;
    setBusy(sessionId || action);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/customer/security', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, sessionId })
      });
      const payload = response.status === 204 ? {} : await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to revoke session.');
      if (action === 'revoke_session') setMessage('Session revoked successfully.');
      else if (action === 'revoke_stale') setMessage(`${Number(payload.revokedCount || 0)} dormant session${Number(payload.revokedCount || 0) === 1 ? '' : 's'} cleaned up.`);
      else setMessage(`${Number(payload.revokedCount || 0)} other session${Number(payload.revokedCount || 0) === 1 ? '' : 's'} revoked.`);
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke session.');
      setBusy('');
    }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span>ACCOUNT SECURITY</span>
          <h1>Sessions, devices and recovery activity</h1>
          <p>Review where your account is signed in, identify dormant access and revoke sessions you no longer trust.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={Boolean(busy)}>
          <RefreshCw className={busy === 'refresh' ? styles.spin : ''} size={17} /> Refresh
        </button>
      </header>

      {message ? <div className={styles.success}><CheckCircle2 size={18} />{message}</div> : null}
      {error ? <div className={styles.error}><AlertTriangle size={18} />{error}</div> : null}

      {!data ? (
        <section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>Loading account security…</strong></section>
      ) : (
        <>
          <section className={styles.summary}>
            <article><ShieldCheck /><div><strong>{data.summary.active}</strong><span>Active sessions</span></div></article>
            <article><ShieldAlert /><div><strong>{data.summary.needsReview}</strong><span>Need review</span></div></article>
            <article><AlertTriangle /><div><strong>{data.summary.highRisk}</strong><span>High-risk sessions</span></div></article>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div><h2>Active sessions</h2><p>Risk combines device familiarity, inactivity and session age. Your current browser cannot be revoked here.</p></div>
              <div>
                <button type="button" disabled={!data.summary.highRisk || Boolean(busy)} onClick={() => void revoke('revoke_stale')}>
                  <ShieldAlert size={16} /> Clean up 30+ day sessions
                </button>
                <button type="button" className={styles.danger} disabled={!otherSessions.length || Boolean(busy)} onClick={() => void revoke('revoke_others')}>
                  <LogOut size={16} /> Revoke all other sessions
                </button>
              </div>
            </div>
            <div className={styles.sessions}>
              {data.sessions.map((session) => (
                <article key={session.id} className={session.current ? styles.current : ''}>
                  <span className={styles.device}>{/mobile|android|ios/i.test(session.client) ? <Smartphone /> : <Laptop />}</span>
                  <div className={styles.sessionCopy}>
                    <div><strong>{session.client}</strong>{session.current ? <em>Current session</em> : <em>{riskLabel(session.risk)}</em>}</div>
                    <p>{session.risk.reason} · Last active {formatDate(session.lastSeenAt)}</p>
                    <small>Started {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}</small>
                  </div>
                  {session.current && !session.explicitlyTrusted ? (
                    <button type="button" disabled={Boolean(busy)} onClick={() => void trustCurrentDevice()}>
                      {busy === 'trust-current' ? <LoaderCircle className={styles.spin} size={16} /> : <ShieldCheck size={16} />} Trust this device
                    </button>
                  ) : !session.current ? (
                    <button type="button" disabled={Boolean(busy)} onClick={() => void revoke('revoke_session', session.id)}>
                      {busy === session.id ? <LoaderCircle className={styles.spin} size={16} /> : <LogOut size={16} />} Revoke
                    </button>
                  ) : <ShieldCheck className={styles.safe} />}
                </article>
              ))}
            </div>
          </section>

          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelTitle}><div><h2>Security activity</h2><p>Recent account-level events, newest first.</p></div></div>
              <div className={styles.timeline}>
                {data.events.map((event) => (
                  <article key={event.id}><span /><div><strong>{eventLabel(event.action)}</strong><small>{formatDate(event.createdAt)}</small></div></article>
                ))}
                {!data.events.length ? <p className={styles.empty}>No recent security events.</p> : null}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelTitle}><div><h2>Password protection</h2><p>Use a unique password and reset it immediately after suspicious activity.</p></div><KeyRound /></div>
              <div className={styles.guidance}>
                <p>Changing your password through recovery invalidates every existing session on all devices.</p>
                <Link href="/forgot-password">Reset password securely</Link>
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
