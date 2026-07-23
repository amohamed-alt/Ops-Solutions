'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Globe2, LoaderCircle, MoonStar, Palette, SunMedium } from 'lucide-react';

import { RevenueCommandCenter } from './RevenueCommandCenter';
import './dashboard-workspace-experience.css';

type Workspace = {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'viewer';
};

type Preferences = {
  workspaceId: string;
  name: string;
  currency: string;
  timezone: string;
  locale: string;
  appearance: 'system' | 'light' | 'dark';
  accentColor: string;
  logoUrl: string | null;
};

const FALLBACK_PREFERENCES: Omit<Preferences, 'workspaceId' | 'name'> = {
  currency: 'USD',
  timezone: 'UTC',
  locale: 'en-US',
  appearance: 'system',
  accentColor: '#0f766e',
  logoUrl: null
};

function safeInitials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'OI';
}

function formatLocalTime(preferences: Preferences) {
  try {
    return new Intl.DateTimeFormat(preferences.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: preferences.timezone
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

function appearanceIcon(appearance: Preferences['appearance']) {
  if (appearance === 'dark') return <MoonStar size={15} />;
  if (appearance === 'light') return <SunMedium size={15} />;
  return <Palette size={15} />;
}

export function DashboardWorkspaceExperience() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [workspaces, selectedId]
  );

  const applyPreferences = useCallback((next: Preferences) => {
    const root = document.documentElement;
    root.style.setProperty('--workspace-accent', next.accentColor || FALLBACK_PREFERENCES.accentColor);
    root.style.setProperty('--workspace-accent-soft', `${next.accentColor || FALLBACK_PREFERENCES.accentColor}1a`);
    root.dataset.workspaceAppearance = next.appearance || 'system';
    root.lang = next.locale?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
    root.dir = next.locale?.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
  }, []);

  const loadPreferences = useCallback(async (workspace: Workspace) => {
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspace.id)}/preferences`, {
        cache: 'no-store'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to load workspace presentation settings.');
      const next: Preferences = {
        workspaceId: workspace.id,
        name: payload.name || workspace.name,
        currency: payload.currency || FALLBACK_PREFERENCES.currency,
        timezone: payload.timezone || FALLBACK_PREFERENCES.timezone,
        locale: payload.locale || FALLBACK_PREFERENCES.locale,
        appearance: payload.appearance || FALLBACK_PREFERENCES.appearance,
        accentColor: payload.accentColor || FALLBACK_PREFERENCES.accentColor,
        logoUrl: payload.logoUrl || null
      };
      setPreferences(next);
      applyPreferences(next);
      window.localStorage.setItem('ops:last-dashboard-workspace', workspace.id);
    } catch (error) {
      const fallback: Preferences = {
        workspaceId: workspace.id,
        name: workspace.name,
        ...FALLBACK_PREFERENCES
      };
      setPreferences(fallback);
      applyPreferences(fallback);
      setNotice(error instanceof Error ? error.message : 'Workspace presentation settings are unavailable.');
    } finally {
      setLoading(false);
    }
  }, [applyPreferences]);

  useEffect(() => {
    let active = true;
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to open the revenue command center.');
        return response.json();
      })
      .then((payload) => {
        if (!active) return;
        const rows = (payload.workspaces ?? []) as Workspace[];
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((workspace) => workspace.id === remembered) ?? rows[0] ?? null;
        setWorkspaces(rows);
        setSelectedId(selected?.id ?? '');
        if (selected) void loadPreferences(selected);
        else setLoading(false);
      })
      .catch((error) => {
        if (!active) return;
        setNotice(error instanceof Error ? error.message : 'Unable to load workspace context.');
        setLoading(false);
      });
    return () => { active = false; };
  }, [loadPreferences]);

  useEffect(() => {
    function captureWorkspaceChange(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      const workspace = workspaces.find((item) => item.id === target.value);
      if (!workspace || workspace.id === selectedId) return;
      setSelectedId(workspace.id);
      void loadPreferences(workspace);
    }
    document.addEventListener('change', captureWorkspaceChange, true);
    return () => document.removeEventListener('change', captureWorkspaceChange, true);
  }, [loadPreferences, selectedId, workspaces]);

  useEffect(() => () => {
    const root = document.documentElement;
    root.style.removeProperty('--workspace-accent');
    root.style.removeProperty('--workspace-accent-soft');
    delete root.dataset.workspaceAppearance;
    root.lang = 'en';
    root.dir = 'ltr';
  }, []);

  return (
    <div className="dashboard-workspace-experience">
      <section className="dashboard-workspace-brand" aria-live="polite">
        <div className="dashboard-workspace-logo" aria-hidden="true">
          {preferences?.logoUrl ? <img src={preferences.logoUrl} alt="" /> : <span>{safeInitials(preferences?.name || selectedWorkspace?.name || 'Ops Intelligence')}</span>}
        </div>
        <div className="dashboard-workspace-copy">
          <small>LIVE REVENUE WORKSPACE</small>
          <h1>{preferences?.name || selectedWorkspace?.name || 'Revenue Command Center'}</h1>
          <p>
            <span><Globe2 size={14} />{preferences?.locale || FALLBACK_PREFERENCES.locale}</span>
            <span>{preferences?.timezone || FALLBACK_PREFERENCES.timezone}</span>
            <span>{preferences?.currency || FALLBACK_PREFERENCES.currency}</span>
            <span>{appearanceIcon(preferences?.appearance || FALLBACK_PREFERENCES.appearance)}{preferences?.appearance || FALLBACK_PREFERENCES.appearance}</span>
          </p>
        </div>
        <div className="dashboard-workspace-clock">
          {loading ? <LoaderCircle className="dashboard-workspace-spin" size={18} /> : <Building2 size={18} />}
          <div><small>WORKSPACE TIME</small><strong>{preferences ? formatLocalTime(preferences) : 'Loading…'}</strong></div>
        </div>
      </section>
      {notice ? <div className="dashboard-workspace-notice">{notice} Safe defaults are active.</div> : null}
      <RevenueCommandCenter />
    </div>
  );
}
