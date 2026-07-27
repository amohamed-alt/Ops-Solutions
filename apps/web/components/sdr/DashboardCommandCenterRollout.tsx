'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';

import { CommandCenterV2 as StableCommandCenter } from './CommandCenterV2';
import { RevenueCommandCenter as LabelAwareCommandCenter } from './RevenueCommandCenter';

type Props = {
  labelAwareEnabled: boolean;
};

const ROLLOUT_RECOVERY_TIMEOUT_MS = 20_000;

export function DashboardCommandCenterRollout({ labelAwareEnabled }: Props) {
  const [useStableFallback, setUseStableFallback] = useState(!labelAwareEnabled);
  const [showRecovery, setShowRecovery] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!labelAwareEnabled || useStableFallback) return undefined;
    setShowRecovery(false);
    const timer = window.setTimeout(() => setShowRecovery(true), ROLLOUT_RECOVERY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [labelAwareEnabled, retryKey, useStableFallback]);

  if (useStableFallback) {
    return <StableCommandCenter />;
  }

  return (
    <>
      <LabelAwareCommandCenter key={retryKey} />
      {showRecovery ? (
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
