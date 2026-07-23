'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Globe2, LoaderCircle, MoonStar, Palette, Save, SunMedium } from 'lucide-react';

import styles from './preferences.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type Preferences = {
  workspaceId: string;
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  locale: string;
  appearance: 'system' | 'light' | 'dark';
  accentColor: string;
  logoUrl: string | null;
  updatedAt?: string | null;
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'EGP', 'QAR', 'KWD', 'BHD', 'OMR'];
const TIMEZONES = ['UTC', 'Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Muscat', 'Europe/London', 'America/New_York'];
const LOCALES = ['en-US', 'en-GB', 'ar-EG', 'ar-SA', 'ar-AE'];
const roleRank = { viewer: 1, admin: 2, owner: 3 };

function formatUpdated(value?: string | null, locale = 'en-US', timezone = 'UTC') {
  if (!value) return 'Not updated yet';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}

export default function WorkspacePreferencesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canEdit = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);

  const load = useCallback(async (id: string) => {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/preferences`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to load workspace preferences.');
      setPreferences(payload);
      setDraft(payload);
      document.documentElement.style.setProperty('--workspace-accent', payload.accentColor || '#0f766e');
      document.documentElement.dataset.workspaceAppearance = payload.appearance || 'system';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load workspace preferences.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to manage workspace preferences.');
        const payload = await response.json();
        const rows = (payload.workspaces ?? []) as Workspace[];
        const requested = new URLSearchParams(window.location.search).get('workspaceId') ?? '';
        setWorkspaces(rows);
        setWorkspaceId(rows.some((item) => item.id === requested) ? requested : (rows[0]?.id ?? ''));
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId, load]);

  async function save() {
    if (!draft || !workspaceId || !canEdit || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/preferences`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to save workspace preferences.');
      setPreferences(payload);
      setDraft(payload);
      document.documentElement.style.setProperty('--workspace-accent', payload.accentColor);
      document.documentElement.dataset.workspaceAppearance = payload.appearance;
      setMessage('Workspace preferences saved successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save workspace preferences.');
    } finally {
      setBusy(false);
    }
  }

  const previewCurrency = useMemo(() => {
    if (!draft) return '';
    try { return new Intl.NumberFormat(draft.locale, { style: 'currency', currency: draft.currency, maximumFractionDigits: 0 }).format(125000); }
    catch { return `${draft.currency} 125,000`; }
  }, [draft]);

  return (
    <main className={styles.shell} style={{ '--accent': draft?.accentColor || '#0f766e' } as React.CSSProperties}>
      <header className={styles.header}>
        <div><span>WORKSPACE PREFERENCES</span><h1>Branding, currency & localization</h1><p>Configure how each company appears across dashboards, exports and scheduled reports.</p></div>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </header>

      {message ? <div className={styles.message}>{message}</div> : null}
      {!draft ? <section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>Loading workspace preferences…</strong></section> : <>
        <section className={styles.preview}>
          <div className={styles.logo}>{draft.logoUrl ? <img src={draft.logoUrl} alt="Workspace logo preview" /> : <Building2 />}</div>
          <div><small>LIVE PREVIEW</small><h2>{draft.name}</h2><p>{draft.locale} · {draft.timezone} · {previewCurrency}</p></div>
          <span className={styles.swatch} aria-label={`Accent color ${draft.accentColor}`} />
        </section>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Company identity</h2><p>Use a consistent name and logo across customer-facing reports.</p></div><Building2 /></div>
            <label>Company name<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} disabled={!canEdit} maxLength={120} /></label>
            <label>Logo URL<input value={draft.logoUrl ?? ''} onChange={(event) => setDraft({ ...draft, logoUrl: event.target.value || null })} disabled={!canEdit} placeholder="https://cdn.example.com/logo.png" /></label>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Regional formatting</h2><p>Controls money, dates and schedule interpretation.</p></div><Globe2 /></div>
            <div className={styles.twoColumns}>
              <label>Currency<select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} disabled={!canEdit}>{CURRENCIES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Locale<select value={draft.locale} onChange={(event) => setDraft({ ...draft, locale: event.target.value })} disabled={!canEdit}>{LOCALES.map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <label>Timezone<select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} disabled={!canEdit}>{TIMEZONES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <div className={styles.example}><strong>{previewCurrency}</strong><span>{formatUpdated(new Date().toISOString(), draft.locale, draft.timezone)}</span></div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Appearance</h2><p>Choose a preferred theme and accessible accent color.</p></div><Palette /></div>
            <div className={styles.appearance}>
              {(['system', 'light', 'dark'] as const).map((item) => <button key={item} type="button" className={draft.appearance === item ? styles.selected : ''} onClick={() => canEdit && setDraft({ ...draft, appearance: item })} disabled={!canEdit}>{item === 'dark' ? <MoonStar /> : <SunMedium />}{item}</button>)}
            </div>
            <label>Accent color<div className={styles.colorInput}><input type="color" value={draft.accentColor} onChange={(event) => setDraft({ ...draft, accentColor: event.target.value })} disabled={!canEdit} /><input value={draft.accentColor} onChange={(event) => setDraft({ ...draft, accentColor: event.target.value })} disabled={!canEdit} pattern="^#[0-9a-fA-F]{6}$" /></div></label>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelTitle}><div><h2>Governance</h2><p>Settings are isolated per company and changes are audited.</p></div><CheckCircle2 /></div>
            <dl><div><dt>Your role</dt><dd>{workspace?.role ?? '—'}</dd></div><div><dt>Last updated</dt><dd>{formatUpdated(preferences?.updatedAt, draft.locale, draft.timezone)}</dd></div><div><dt>Workspace slug</dt><dd>{draft.slug}</dd></div></dl>
            {!canEdit ? <p className={styles.locked}>Viewer access is read-only. An admin or owner can update these preferences.</p> : null}
          </section>
        </div>

        <footer className={styles.footer}><button type="button" onClick={() => setDraft(preferences)} disabled={busy || !canEdit}>Reset</button><button type="button" className={styles.primary} onClick={() => void save()} disabled={busy || !canEdit}><Save />{busy ? 'Saving…' : 'Save preferences'}</button></footer>
      </>}
    </main>
  );
}
