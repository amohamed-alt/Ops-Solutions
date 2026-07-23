'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  CloudOff,
  Crown,
  Globe2,
  LoaderCircle,
  LogOut,
  MoonStar,
  Palette,
  RefreshCw,
  Settings2,
  SunMedium,
  Target,
  UserRoundSearch,
  UsersRound,
  Wrench,
  type LucideIcon
} from 'lucide-react';

import { RevenueCommandCenter } from './RevenueCommandCenter';
import './dashboard-workspace-experience.css';
import './enterprise-command-center.css';

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

type DataHealth = {
  status: string;
  severity: 'success' | 'info' | 'warning' | 'critical';
  message: string;
  totalRecords: number;
  newestSync: string | null;
  activeRun: null | { mode?: string; status?: string };
};

type CommandRole = 'executive' | 'manager' | 'sdr' | 'revops';

type CommandRoleOption = {
  id: CommandRole;
  label: string;
  kicker: string;
  description: string;
  icon: LucideIcon;
};

const ROLE_OPTIONS: CommandRoleOption[] = [
  {
    id: 'executive',
    label: 'Executive',
    kicker: 'Revenue & forecast',
    description: 'Revenue, pipeline coverage, commercial risk and leadership decisions.',
    icon: Crown
  },
  {
    id: 'manager',
    label: 'Sales Manager',
    kicker: 'Team execution',
    description: 'Rep performance, activity conversion, pipeline movement and interventions.',
    icon: UsersRound
  },
  {
    id: 'sdr',
    label: 'SDR Workspace',
    kicker: 'Daily execution',
    description: 'Priority outreach, meetings, overdue actions and source performance.',
    icon: UserRoundSearch
  },
  {
    id: 'revops',
    label: 'RevOps',
    kicker: 'Systems & quality',
    description: 'Data quality, synchronization health, task operations and CRM readiness.',
    icon: Wrench
  }
];

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

function formatLocalTime(preferences: Preferences, date = new Date()) {
  try {
    return new Intl.DateTimeFormat(preferences.locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: preferences.timezone
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatRelativeTime(value: string | null, preferences: Preferences | null) {
  if (!value) return 'No synchronized data yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sync time unavailable';
  const elapsed = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${preferences ? formatLocalTime(preferences, date) : date.toLocaleString()}`;
}

function appearanceIcon(appearance: Preferences['appearance']) {
  if (appearance === 'dark') return <MoonStar size={15} />;
  if (appearance === 'light') return <SunMedium size={15} />;
  return <Palette size={15} />;
}

function healthIcon(health: DataHealth | null, online: boolean) {
  if (!online) return <CloudOff size={17} />;
  if (!health) return <LoaderCircle className="dashboard-workspace-spin" size={17} />;
  if (health.severity === 'success') return <CheckCircle2 size={17} />;
  if (health.severity === 'info') return <Activity size={17} />;
  return <AlertTriangle size={17} />;
}

function isCommandRole(value: string | null): value is CommandRole {
  return ROLE_OPTIONS.some((option) => option.id === value);
}

export function DashboardWorkspaceExperience() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [clock, setClock] = useState(() => new Date());
  const [online, setOnline] = useState(true);
  const [health, setHealth] = useState<DataHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [commandRole, setCommandRole] = useState<CommandRole>('executive');
  const [signingOut, setSigningOut] = useState(false);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [workspaces, selectedId]
  );

  const activeRole = useMemo(
    () => ROLE_OPTIONS.find((option) => option.id === commandRole) ?? ROLE_OPTIONS[0],
    [commandRole]
  );

  const applyPreferences = useCallback((next: Preferences) => {
    const root = document.documentElement;
    root.style.setProperty('--workspace-accent', next.accentColor || FALLBACK_PREFERENCES.accentColor);
    root.style.setProperty('--workspace-accent-soft', `${next.accentColor || FALLBACK_PREFERENCES.accentColor}1a`);
    root.dataset.workspaceAppearance = next.appearance || 'system';
    root.lang = next.locale?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
    root.dir = next.locale?.toLowerCase().startsWith('ar') ? 'rtl' : 'ltr';
  }, []);

  const loadHealth = useCallback(async (workspaceId: string, silent = false) => {
    if (!workspaceId || !navigator.onLine) return;
    if (!silent) setHealthLoading(true);
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/operations`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to read data health.');
      setHealth({
        status: payload.health?.status || 'unknown',
        severity: payload.health?.severity || 'warning',
        message: payload.health?.message || 'Data health status is unavailable.',
        totalRecords: Number(payload.sync?.freshness?.total_records || 0),
        newestSync: payload.sync?.freshness?.newest_record_sync || null,
        activeRun: payload.sync?.activeRun || null
      });
    } catch {
      setHealth((current) => current ?? {
        status: 'unavailable',
        severity: 'warning',
        message: 'Live data health could not be refreshed.',
        totalRecords: 0,
        newestSync: null,
        activeRun: null
      });
    } finally {
      if (!silent) setHealthLoading(false);
    }
  }, []);

  const loadPreferences = useCallback(async (workspace: Workspace) => {
    setLoading(true);
    setNotice('');
    setHealth(null);
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
      void loadHealth(workspace.id);
    }
  }, [applyPreferences, loadHealth]);

  useEffect(() => {
    const rememberedRole = window.localStorage.getItem('ops:dashboard-command-role');
    if (isCommandRole(rememberedRole)) setCommandRole(rememberedRole);
  }, []);

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
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    function updateConnectivity() {
      setOnline(navigator.onLine);
      if (navigator.onLine && selectedId) void loadHealth(selectedId);
    }
    setOnline(navigator.onLine);
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    return () => {
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
    };
  }, [loadHealth, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void loadHealth(selectedId, true);
    }, 60_000);
    return () => window.clearInterval(poll);
  }, [loadHealth, selectedId]);

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

  function selectCommandRole(nextRole: CommandRole) {
    setCommandRole(nextRole);
    window.localStorage.setItem('ops:dashboard-command-role', nextRole);
    window.requestAnimationFrame(() => {
      document.getElementById('overview')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/customer/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/onboarding');
      router.refresh();
    }
  }

  const healthTone = !online ? 'critical' : health?.severity || 'info';
  const healthLabel = !online
    ? 'Offline'
    : health?.activeRun
      ? `${health.activeRun.mode || 'CRM'} sync running`
      : health?.status || 'Checking data health';

  return (
    <div className="dashboard-workspace-experience" data-command-role={commandRole}>
      <section className="dashboard-workspace-brand" aria-live="polite">
        <div className="dashboard-workspace-logo" aria-hidden="true">
          {preferences?.logoUrl ? <img src={preferences.logoUrl} alt="" /> : <span>{safeInitials(preferences?.name || selectedWorkspace?.name || 'Ops Intelligence')}</span>}
        </div>
        <div className="dashboard-workspace-copy">
          <small>OPS INTELLIGENCE · LIVE REVENUE WORKSPACE</small>
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
          <div><small>WORKSPACE TIME</small><strong>{preferences ? formatLocalTime(preferences, clock) : 'Loading…'}</strong></div>
        </div>
      </section>

      <section className="dashboard-command-mode" aria-label="Dashboard audience">
        <div className="dashboard-command-mode-copy">
          <span><Target size={16} /></span>
          <div>
            <small>ROLE-BASED COMMAND CENTER</small>
            <strong>{activeRole.label}</strong>
            <p>{activeRole.description}</p>
          </div>
        </div>
        <div className="dashboard-command-mode-options" role="tablist" aria-label="Choose dashboard role">
          {ROLE_OPTIONS.map(({ id, label, kicker, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={commandRole === id}
              className={commandRole === id ? 'active' : ''}
              onClick={() => selectCommandRole(id)}
            >
              <Icon size={17} />
              <span><strong>{label}</strong><small>{kicker}</small></span>
            </button>
          ))}
        </div>
        <div className="dashboard-command-actions">
          <a href="/settings/workspace"><Settings2 size={16} />Manage</a>
          <button type="button" onClick={() => void signOut()} disabled={signingOut}>
            <LogOut size={16} />{signingOut ? 'Signing out' : 'Sign out'}
          </button>
        </div>
      </section>

      <section className={`dashboard-data-health dashboard-data-health-${healthTone}`} aria-live="polite">
        <span className="dashboard-data-health-icon">{healthIcon(health, online)}</span>
        <div>
          <small>LIVE DATA HEALTH</small>
          <strong>{healthLabel}</strong>
          <p>{!online ? 'Reconnect to refresh HubSpot data health.' : health?.message || 'Checking synchronization freshness and connection status.'}</p>
        </div>
        <div className="dashboard-data-health-meta">
          <span>{health ? new Intl.NumberFormat(preferences?.locale || 'en-US').format(health.totalRecords) : '—'} records</span>
          <span>{formatRelativeTime(health?.newestSync || null, preferences)}</span>
        </div>
        <button type="button" onClick={() => void loadHealth(selectedId)} disabled={!online || healthLoading || !selectedId}>
          <RefreshCw className={healthLoading ? 'dashboard-workspace-spin' : ''} size={15} />
          Refresh health
        </button>
      </section>
      {notice ? <div className="dashboard-workspace-notice">{notice} Safe defaults are active.</div> : null}
      <RevenueCommandCenter />
    </div>
  );
}
