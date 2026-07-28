'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

import { CommandCenterV2 as StableCommandCenter } from './CommandCenterV2';
import { RevenueCommandCenter as LabelAwareCommandCenter } from './RevenueCommandCenter';
import {
  formatReportingConfidenceStatus,
  isDashboardReportRequest,
  reportingConfidenceFromPayload,
  type ReportingConfidenceStatus
} from './reporting-confidence-status';

type Props = {
  labelAwareEnabled: boolean;
};

type WorkspaceSummary = {
  workspace?: {
    id?: string;
    name?: string;
    hubspot_status?: string;
  };
  freshness?: {
    newest_record_sync?: string | null;
    total_records?: number | null;
  } | null;
};

type SyncStatus = {
  label: string;
  detail: string;
  tone: 'synced' | 'pending' | 'delayed' | 'failed';
};

const ROLLOUT_RECOVERY_TIMEOUT_MS = 20_000;
const SAVED_VIEW_DELETE_PATTERN = /\/api\/customer\/workspaces\/[^/]+\/saved-views\/[^/?#]+(?:[?#].*)?$/;
const SYNC_STATUS_REFRESH_MS = 5 * 60 * 1000;

async function savedViewDeleteError(response: Response) {
  const payload = await response.clone().json().catch(() => ({} as { message?: string }));
  return new Error(payload.message || `Saved view delete failed with HTTP ${response.status}.`);
}

function isSavedViewDelete(input: RequestInfo | URL, init?: RequestInit) {
  const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (method !== 'DELETE') return false;
  const url = input instanceof Request ? input.url : String(input);
  return SAVED_VIEW_DELETE_PATTERN.test(url);
}

function selectWorkspaceForSync(rows: WorkspaceSummary[]) {
  const remembered = window.localStorage.getItem('ops:last-dashboard-workspace');
  return rows.find((row) => row.workspace?.id === remembered)
    ?? rows.find((row) => row.workspace?.hubspot_status === 'connected')
    ?? rows[0]
    ?? null;
}

function formatSyncStatus(row: WorkspaceSummary | null): SyncStatus {
  if (!row) {
    return { label: 'Sync pending', detail: 'No connected HubSpot workspace is available yet.', tone: 'pending' };
  }
  const newestSync = row.freshness?.newest_record_sync;
  const totalRecords = Number(row.freshness?.total_records ?? 0);
  if (!newestSync) {
    return { label: 'Sync pending', detail: `${row.workspace?.name ?? 'Workspace'} has no completed CRM sync snapshot yet.`, tone: 'pending' };
  }
  const syncedAt = new Date(String(newestSync));
  if (Number.isNaN(syncedAt.getTime())) {
    return { label: 'Sync status unavailable', detail: 'The latest CRM sync timestamp could not be read.', tone: 'failed' };
  }
  const ageHours = Math.max(0, (Date.now() - syncedAt.getTime()) / 3_600_000);
  const formatted = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(syncedAt);
  const tone = ageHours > 24 ? 'delayed' : 'synced';
  return {
    label: tone === 'delayed' ? 'Data delayed' : 'Synced from HubSpot',
    detail: `Last synced ${formatted}${totalRecords ? ` · ${totalRecords.toLocaleString()} CRM records` : ''}`,
    tone
  };
}

function useSyncStatus() {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const response = await fetch('/api/customer/workspaces', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Workspace sync status failed with HTTP ${response.status}.`);
        const payload = await response.json().catch(() => ({ results: [] }));
        const rows = (payload.results ?? []) as WorkspaceSummary[];
        if (active) setSyncStatus(formatSyncStatus(selectWorkspaceForSync(rows)));
      } catch {
        if (active) setSyncStatus({ label: 'Sync status unavailable', detail: 'Unable to check the latest HubSpot sync state.', tone: 'failed' });
      }
    }
    void loadStatus();
    const timer = window.setInterval(loadStatus, SYNC_STATUS_REFRESH_MS);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  return syncStatus;
}

function useReportingConfidenceObserver() {
  const [status, setStatus] = useState<ReportingConfidenceStatus | null>(null);

  useEffect(() => {
    let active = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      if (response.ok && isDashboardReportRequest(input, init)) {
        void response.clone().json()
          .then((payload) => {
            if (!active) return;
            setStatus(formatReportingConfidenceStatus(reportingConfidenceFromPayload(payload)));
          })
          .catch(() => undefined);
      }
      return response;
    };
    return () => {
      active = false;
      window.fetch = originalFetch;
    };
  }, []);

  return status;
}

function useSavedViewDeleteGuard() {
  const [savedViewDeleteErrorMessage, setSavedViewDeleteErrorMessage] = useState('');

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      if (isSavedViewDelete(input, init) && !response.ok) {
        const error = await savedViewDeleteError(response);
        setSavedViewDeleteErrorMessage(error.message);
        throw error;
      }
      return response;
    };
    return () => { window.fetch = originalFetch; };
  }, []);

  return {
    savedViewDeleteErrorMessage,
    clearSavedViewDeleteError: () => setSavedViewDeleteErrorMessage('')
  };
}

export function DashboardCommandCenterRollout({ labelAwareEnabled }: Props) {
  const [useStableFallback, setUseStableFallback] = useState(!labelAwareEnabled);
  const [showRecovery, setShowRecovery] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const syncStatus = useSyncStatus();
  const reportingConfidence = useReportingConfidenceObserver();
  const { savedViewDeleteErrorMessage, clearSavedViewDeleteError } = useSavedViewDeleteGuard();

  useEffect(() => {
    if (!labelAwareEnabled || useStableFallback) return undefined;
    setShowRecovery(false);
    const timer = window.setTimeout(() => setShowRecovery(true), ROLLOUT_RECOVERY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [labelAwareEnabled, retryKey, useStableFallback]);

  const activeCommandCenter = useStableFallback
    ? <StableCommandCenter />
    : <LabelAwareCommandCenter key={retryKey} />;
  const syncAccent = syncStatus?.tone === 'synced' ? '#0f766e' : syncStatus?.tone === 'delayed' ? '#b45309' : syncStatus?.tone === 'failed' ? '#b91c1c' : '#475569';
  const confidenceAccent = reportingConfidence?.level === 'exact' ? '#0f766e' : reportingConfidence?.level === 'inferred' ? '#b45309' : '#b91c1c';

  return (
    <>
      {activeCommandCenter}
      {reportingConfidence ? (
        <div
          className={`dashboard-reporting-confidence ${reportingConfidence.level}`}
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 18,
            bottom: syncStatus ? 108 : 18,
            zIndex: 70,
            maxWidth: 360,
            padding: '12px 14px',
            borderRadius: 16,
            border: '1px solid rgba(15, 23, 42, 0.12)',
            background: 'rgba(255, 255, 255, 0.96)',
            boxShadow: '0 18px 48px rgba(15, 23, 42, 0.16)',
            color: '#0f172a',
            display: 'grid',
            gap: 5,
            fontSize: 12
          }}
        >
          <strong style={{ color: confidenceAccent }}>{reportingConfidence.label}</strong>
          <span>{reportingConfidence.detail}</span>
          {reportingConfidence.actionHref && reportingConfidence.actionLabel ? (
            <Link href={reportingConfidence.actionHref} style={{ color: confidenceAccent, fontWeight: 800 }}>
              {reportingConfidence.actionLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
      {syncStatus ? (
        <div
          className={`dashboard-sync-status ${syncStatus.tone}`}
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 18,
            bottom: 18,
            zIndex: 70,
            maxWidth: 360,
            padding: '12px 14px',
            borderRadius: 16,
            border: '1px solid rgba(15, 23, 42, 0.12)',
            background: 'rgba(255, 255, 255, 0.96)',
            boxShadow: '0 18px 48px rgba(15, 23, 42, 0.16)',
            color: '#0f172a',
            display: 'grid',
            gap: 4,
            fontSize: 12
          }}
        >
          <strong style={{ color: syncAccent }}>{syncStatus.label}</strong>
          <span>{syncStatus.detail}</span>
        </div>
      ) : null}
      {savedViewDeleteErrorMessage ? (
        <div className="dashboard-rollout-recovery saved-view-delete-guard" role="alert" aria-live="assertive">
          <div>
            <span><AlertTriangle size={17} /></span>
            <div>
              <strong>Saved view was not deleted.</strong>
              <p>{savedViewDeleteErrorMessage}</p>
            </div>
          </div>
          <button type="button" className="primary" onClick={clearSavedViewDeleteError}>Dismiss</button>
        </div>
      ) : null}
      {!useStableFallback && showRecovery ? (
        <div className="dashboard-rollout-recovery" role="alert" aria-live="assertive">
          <div>
            <span><AlertTriangle size={17} /></span>
            <div>
              <strong>The enhanced dashboard is taking longer than expected.</strong>
              <p>
                Your reports and tenant data are safe. You can retry the enhanced dashboard or return to the stable
                command center while we finish the rollout checks.
              </p>
            </div>
          </div>
          <button type="button" onClick={() => { setShowRecovery(false); setRetryKey((value) => value + 1); }}>
            <RefreshCw size={15} />Retry enhanced dashboard
          </button>
          <button type="button" className="primary" onClick={() => setUseStableFallback(true)}>
            <ShieldCheck size={15} />Use stable dashboard
          </button>
        </div>
      ) : null}
    </>
  );
}
