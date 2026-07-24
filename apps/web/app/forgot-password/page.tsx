'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

import styles from '../password-recovery.module.css';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/customer/auth/password/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to request a reset link.');
      setMessage(payload.message || 'If an account exists, a reset link will be sent.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request a reset link.');
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.shell}><section className={styles.card}>
    <div className={styles.brand}><span className={styles.mark}>OS</span><div><div className={styles.eyebrow}>OPS SOLUTIONS</div><strong>Account security</strong></div></div>
    <h1>Reset your password</h1>
    <p>Enter your work email. For security, the response is the same whether or not an account exists.</p>
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}><label htmlFor="email">Work email</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></div>
      <button className={styles.button} type="submit" disabled={busy}>{busy ? 'Sending secure link…' : 'Send reset link'}</button>
    </form>
    {message ? <div className={styles.message} role="status">{message}</div> : null}
    {error ? <div className={`${styles.message} ${styles.error}`} role="alert">{error}</div> : null}
    <div className={styles.links}><Link href="/onboarding">Back to sign in</Link><Link href="/">Ops Solutions</Link></div>
  </section></main>;
}
