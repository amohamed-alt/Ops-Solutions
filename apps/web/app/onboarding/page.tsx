import { Suspense } from 'react';

import OnboardingClient from './OnboardingClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Connect HubSpot · Ops Intelligence',
  description: 'Create a company workspace, connect HubSpot, and generate live revenue dashboards.'
};

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className={styles.loadingPage}>Preparing your workspace…</main>}>
      <OnboardingClient />
    </Suspense>
  );
}
