'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, BarChart3, Bookmark, Building2, CalendarDays, CheckCircle2,
  Download, FileSpreadsheet, Filter, LoaderCircle, ShieldCheck
} from 'lucide-react';

import styles from './exports.module.css';

type WorkspaceRow = {
  workspace: { id: string; name: string; hubspot_status?: string };
  freshness?: { newest_record_sync?: string | null } | null;
};

type DatePreset = 'today' | 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'previous_month' | 'this_quarter' | 'this_year' | 'custom';

type SavedView = {
  id: string;
  name: string;
  datePreset: DatePreset;
  filters: {
    from?: string | null;
    to?: string | null;
    ownerId?: string | null;
    country?: string | null;
    leadSource?: string | null;
    pipelineId?: string | null;
    stageId?: string | null;
  };
  isDefault: boolean;
  updatedAt: string;
};

type Filters = {
  from: string;
  to: string;
  ownerId: string;
  country: string;
  leadSource: string;
  pipelineId: string;
  stageId: string;
};

const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  this_month: 'This month',
  previous_month: 'Previous month',
  this_quarter: 'This quarter',
  this_year: 'This year',
  custom: 'Custom range'
};

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function rangeForPreset(preset: DatePreset, now = new Date()) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from = new Date(end);
  let to = new Date(end);
  switch (preset) {
    case 'yesterday':
      from.setDate(from.getDate() - 1);
      to = new Date(from);
      break;
    case 'last_7_days':
      from.setDate(from.getDate() - 6);
      break;
    case 'this_month':
      from = new Date(end.getFullYear(), end.getMonth(), 1);
      break;
    case 'previous_month':
      from = new Date(end.getFullYear(), end.getMonth() - 1, 1);
      to = new Date(end.getFullYear(), end.getMonth(), 0);
      break;
    case 'this_quarter':
      from = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
      break;
    case 'this_year':
      from = new Date(end.getFullYear(), 0, 1);
      break;
    case 'today':
      break;
    case 'last_30_days':
    case 'custom':
    default:
      from.setDate(from.getDate() - 29);
      break;
  }
  return { from: formatDate(from), to: formatDate(to) };
}

function filtersForView(view: SavedView): Filters {
  const dates = view.datePreset === 'custom'
    ? { from: String(view.filters.from || ''), to: String(view.filters.to || '') }
    : rangeForPreset(view.datePreset);
  return {
    ...dates,
    ownerId: String(view.filters.ownerId || ''),
    country: String(view.filters.country || ''),
    leadSource: String(view.filters.leadSource || ''),
    pipelineId: String(view.filters.pipelineId || ''),
    stageId: String(view.filters.stageId || '')
  };
}

function exportQuery(filters: Filters, viewName?: string) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  if (viewName) params.set('viewName', viewName);
  return params.toString();
}

function filenameFromDisposition(disposition: string | null) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || 'revenue-report.csv';
}

export function ExportCenter() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewId, setSelectedViewId] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');

  const selectedWorkspace = useMemo(
    () => workspaces.find((row) => row.workspace.id === workspaceId) ?? null,
    [workspaces, workspaceId]
  );
  const selectedView = useMemo(
    () => savedViews.find((view) => view.id === selectedViewId) ?? null,
    [savedViews, selectedViewId]
  );
  const activeFilters = selectedView ? filtersForView(selectedView) : { ...rangeForPreset('last_30_days'), ownerId: '', country: '', leadSource: '', pipelineId: '', stageId: '' };
  const activeFilterCount = ['ownerId', 'country', 'leadSource', 'pipelineId', 'stageId'].filter((key) => Boolean(activeFilters[key as keyof Filters])).length;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/api/customer/workspaces', { cache: 'no-store' });
        if (response.status === 401) {
          router.replace('/onboarding');
          return;
        }
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to load company workspaces.');
        const rows = (payload.results ?? []).filter((row: WorkspaceRow) => row.workspace.hubspot_status === 'connected');
        if (!active) return;
        setWorkspaces(rows);
        const firstId = rows[0]?.workspace.id || '';
        setWorkspaceId(firstId);
        if (!firstId) setMessage('Connect a HubSpot workspace before creating an export.');
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to open the export center.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!workspaceId) {
      setSavedViews([]);
      setSelectedViewId('');
      return;
    }
    let active = true;
    setMessage('');
    (async () => {
      try {
        const response = await fetch(`/api/customer/workspaces/${workspaceId}/saved-views`, { cache: 'no-store' });
        const payload = await response.json();
        if (response.status === 401) {
          router.replace('/onboarding');
          return;
        }
        if (!response.ok) throw new Error(payload.message || 'Unable to load saved views.');
        if (!active) return;
        const views = (payload.results ?? []) as SavedView[];
        setSavedViews(views);
        setSelectedViewId(views.find((view) => view.isDefault)?.id || '');
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to load saved views.');
      }
    })();
    return () => { active = false; };
  }, [workspaceId, router]);

  async function downloadCsv() {
    if (!workspaceId || downloading) return;
    setDownloading(true);
    setMessage('');
    setSuccess('');
    try {
      const query = exportQuery(activeFilters, selectedView?.name);
      const response = await fetch(`/api/dashboard/${workspaceId}/export?${query}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Unable to generate the CSV export.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filenameFromDisposition(response.headers.get('content-disposition'));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSuccess('Revenue report exported successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to generate the CSV export.');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <main className={styles.loading}><LoaderCircle className={styles.spin} size={34} /><strong>Opening secure exports…</strong><span>Verifying your session and company access.</span></main>;
  }

  return (
    <main className={styles.shell}>
      <section className={styles.hero}>
        <div><span className={styles.eyebrow}>SECURE REPORT DELIVERY</span><h1>Export the complete revenue operation.</h1><p>Download an Excel-ready CSV containing executive KPIs, comparisons, activity trends, pipeline, sources, markets, team performance, outcomes, action queues and CRM data quality.</p></div>
        <div className={styles.trust}><ShieldCheck size={22} /><div><strong>Tenant isolated</strong><span>Every export is authorized against your active customer session and workspace membership.</span></div></div>
      </section>

      {message ? <div className={styles.error}><AlertTriangle size={17} />{message}</div> : null}
      {success ? <div className={styles.success}><CheckCircle2 size={17} />{success}</div> : null}

      <section className={styles.builder}>
        <header><div><FileSpreadsheet size={21} /><div><span className={styles.eyebrow}>CSV EXPORT</span><h2>Revenue intelligence workbook</h2></div></div><b>Excel · Google Sheets · BI ready</b></header>
        <div className={styles.controls}>
          <label><span>Company workspace</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={downloading}><option value="">Choose a connected company</option>{workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}</select></label>
          <label><span>Saved reporting view</span><select value={selectedViewId} onChange={(event) => setSelectedViewId(event.target.value)} disabled={downloading || !workspaceId}><option value="">Current default · Last 30 days</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}{view.isDefault ? ' · Default' : ''}</option>)}</select></label>
          <button onClick={downloadCsv} disabled={!workspaceId || downloading}>{downloading ? <LoaderCircle className={styles.spin} size={17} /> : <Download size={17} />}{downloading ? 'Building export…' : 'Download CSV'}</button>
        </div>

        <div className={styles.summary}>
          <article><Building2 size={18} /><span>Workspace</span><strong>{selectedWorkspace?.workspace.name || 'Not selected'}</strong></article>
          <article><Bookmark size={18} /><span>Reporting view</span><strong>{selectedView?.name || 'Last 30 days'}</strong></article>
          <article><CalendarDays size={18} /><span>Period</span><strong>{activeFilters.from} → {activeFilters.to}</strong></article>
          <article><Filter size={18} /><span>Dimension filters</span><strong>{activeFilterCount}</strong></article>
        </div>
      </section>

      <section className={styles.coverage}>
        <div><span className={styles.eyebrow}>INCLUDED MODULES</span><h2>One export, every decision layer.</h2></div>
        <div className={styles.modules}>{[
          ['Executive performance', 'Portfolio, activity, pipeline and won-revenue KPIs with period comparisons.'],
          ['SDR execution', 'Calls, meetings, tasks, meeting rate and daily activity trends.'],
          ['Pipeline intelligence', 'Open deals, pipeline value and stage-level commercial exposure.'],
          ['Attribution', 'Lead-source performance, opportunities, wins and market distribution.'],
          ['Team scorecards', 'Owner-level activity, conversion, pipeline and won revenue.'],
          ['Operational risk', 'Untouched, stale, unassigned, overdue and no-next-activity queues.'],
          ['CRM data quality', 'Field completeness and overall reporting readiness score.'],
          ['Outcome analysis', 'Call dispositions, meeting outcomes and task statuses.']
        ].map(([title, description]) => <article key={title}><BarChart3 size={17} /><div><strong>{title}</strong><span>{description}</span></div></article>)}</div>
      </section>
    </main>
  );
}
