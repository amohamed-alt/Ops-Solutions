'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, KeyRound, Laptop, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import styles from './security.module.css';

type Session = {
  id: string;
  current: boolean;
  client: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

type SecurityEvent = {
  id: string;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type SecurityPayload = { sessions: Session[]; events: SecurityEvent[] };

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function eventLabel(action: string) {
  const labels: Record<string, string> = {
    'session.revoked': 'A session was revoked',
    'sessions.revoked_others': 'Other sessions were revoked',
    'password.reset_completed': 'Password was reset',
    'password.reset_requested': 'Password recovery was requested',
    'password.reset_delivery_failed': 'Password recovery email failed'
  };
  return labels[action] || action.replaceAll('.', ' ');
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

  async function revoke(action: 'revoke_session' | 'revoke_others', sessionId?: string) {
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
      setMessage(action === 'revoke_others'
        ? `${Number(payload.revokedCount || 0)} other session${Number(payload.revokedCount || 0) === 1 ? '' : 's'} revoked.`
        : 'Session revoked successfully.');
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
          <p>Review where your account is signed in and revoke access you no longer recognize.</p>
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
            <article><ShieldCheck /><div><strong>{data.sessions.length}</strong><span>Active sessions</span></div></article>
            <article><Laptop /><div><strong>{otherSessions.length}</strong><span>Other devices</span></div></article>
            <article><KeyRound /><div><strong>{data.events.length}</strong><span>Recent security events</span></div></article>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}>
              <div><h2>Active sessions</h2><p>Your current browser is protected from individual revocation.</p></div>
              <button type="button" className={styles.danger} disabled={!otherSessions.length || Boolean(busy)} onClick={() => void revoke('revoke_others')}>
                <LogOut size={16} /> Revoke all other sessions
              </button>
            </div>
            <div className={styles.sessions}>
              {data.sessions.map((session) => (
                <article key={session.id} className={session.current ? styles.current : ''}>
                  <span className={styles.device}>{/mobile|android|ios/i.test(session.client) ? <Smartphone /> : <Laptop />}</span>
                  <div className={styles.sessionCopy}>
                    <div><strong>{session.client}</strong>{session.current ? <em>Current session</em> : null}</div>
                    <p>Last active {formatDate(session.lastSeenAt)}</p>
                    <small>Started {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}</small>
                  </div>
                  {!session.current ? (
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
