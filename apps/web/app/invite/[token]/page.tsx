'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, BadgeCheck, LoaderCircle, ShieldCheck, UsersRound } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';

import styles from './invite.module.css';

export default function InvitationPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'signin' | 'ready' | 'error'>('checking');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' }).then((response) => {
      setState(response.ok ? 'ready' : 'signin');
    }).catch(() => setState('signin'));
  }, []);

  async function accept() {
    setState('checking'); setMessage('');
    const response = await fetch(`/api/customer/invitations/${encodeURIComponent(params.token)}/accept`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) { setState('error'); setMessage(payload.message || 'Unable to accept this invitation.'); return; }
    router.push('/dashboard');
  }

  return <main className={styles.shell}><section className={styles.card}>
    <div className={styles.icon}>{state === 'checking' ? <LoaderCircle className={styles.spin} /> : <UsersRound />}</div>
    <span>SECURE WORKSPACE INVITATION</span>
    <h1>Join your team&apos;s revenue workspace.</h1>
    <p>This invitation grants access to a tenant-isolated HubSpot intelligence workspace. Your email must match the invited address.</p>
    <div className={styles.trust}><span><ShieldCheck />Role-based access</span><span><BadgeCheck />Audited membership</span></div>
    {state === 'checking' ? <div className={styles.progress}>Checking your account…</div> : null}
    {state === 'signin' ? <button onClick={() => router.push(`/onboarding?mode=login&returnTo=${encodeURIComponent(`/invite/${params.token}`)}`)}>Sign in to continue<ArrowRight /></button> : null}
    {state === 'ready' ? <button onClick={accept}>Accept invitation<ArrowRight /></button> : null}
    {state === 'error' ? <><div className={styles.error}>{message}</div><button onClick={() => setState('ready')}>Try again<ArrowRight /></button></> : null}
  </section></main>;
}
