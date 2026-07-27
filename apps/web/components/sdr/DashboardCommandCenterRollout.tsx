'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

import { CommandCenterV2 as StableCommandCenter } from './CommandCenterV2';
import { RevenueCommandCenter as LabelAwareCommandCenter } from './RevenueCommandCenter';

type Props = {
  labelAwareEnabled: boolean;
};

const ROLLOUT_RECOVERY_TIMEOUT_MS = 20_000;
const SAVED_VIEW_DELETE_PATTERN = /\/api\/customer\/workspaces\/[^/]+\/saved-views\/[^/?#]+(?:[?#].*)?$/;

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

  return (
    <>
      {activeCommandCenter}
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
