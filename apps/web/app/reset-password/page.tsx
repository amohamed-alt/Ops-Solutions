'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';

import styles from '../password-recovery.module.css';

export default function ResetPasswordPage() {
  const token = useMemo(() => typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('token') || '', []);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setMessage('');
    setError('');
    if (!token) return setError('This reset link is incomplete. Request a new password reset email.');
    if (password.length < 10 || password.length > 200) return setError('Password must contain between 10 and 200 characters.');
    if (password !== confirmPassword) return setError('The passwords do not match.');
    setBusy(true);
    try {
      const response = await fetch('/api/customer/auth/password/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to reset your password.');
      setPassword('');
      setConfirmPassword('');
      setMessage(payload.message || 'Your password was changed. Sign in again.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to reset your password.');
    } finally {
      setBusy(false);
    }
  }

  return <main className={styles.shell}><section className={styles.card}>
    <div className={styles.brand}><span className={styles.mark}>OS</span><div><div className={styles.eyebrow}>OPS SOLUTIONS</div><strong>Account security</strong></div></div>
    <h1>Choose a new password</h1>
    <p>The link is single-use and expires after 30 minutes. Completing the reset signs your account out on every device.</p>
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.field}><label htmlFor="password">New password</label><input id="password" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} /><span className={styles.hint}>Use at least 10 characters.</span></div>
      <div className={styles.field}><label htmlFor="confirmPassword">Confirm password</label><input id="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <button className={styles.button} type="submit" disabled={busy || !token}>{busy ? 'Securing account…' : 'Reset password'}</button>
    </form>
    {message ? <div className={styles.message} role="status">{message}</div> : null}
    {error ? <div className={`${styles.message} ${styles.error}`} role="alert">{error}</div> : null}
    <div className={styles.links}><Link href="/onboarding">Sign in</Link><Link href="/forgot-password">Request another link</Link></div>
  </section></main>;
}
