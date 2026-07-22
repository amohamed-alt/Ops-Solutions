import Link from 'next/link';
import { redirect } from 'next/navigation';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

async function getPlatformConfiguration() {
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://api:3001';

  try {
    const response = await fetch(`${apiUrl}/api/v1/platform`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) throw new Error(`API returned ${response.status}`);
    return { available: true, data: await response.json() };
  } catch (error) {
    return { available: false, error: error.message };
  }
}

export default async function SetupPage({ searchParams }) {
  const params = await searchParams;
  if (params?.hubspot === 'connected' && params?.workspaceId) {
    redirect(`/onboarding?connected=1&workspaceId=${encodeURIComponent(params.workspaceId)}`);
  }

  const platform = await getPlatformConfiguration();
  const hubspot = platform.data?.hubspot;
  const missing = hubspot?.missing ?? [];

  return (
    <main className={`page-shell ${styles.setupShell}`}>
      <div className={styles.topbar}>
        <Link href="/">← Platform overview</Link>
        <span className="pill">Setup center</span>
      </div>

      <section className={styles.setupHero}>
        <span className="eyebrow">HUBSPOT CONNECTION WORKFLOW</span>
        <h1>Connect once. Discover everything.</h1>
        <p className="hero-copy">
          This page tracks the configuration needed before the first customer portal can be
          connected and converted into a reusable analytics model.
        </p>
      </section>

      {!platform.available && (
        <section className={`${styles.notice} ${styles.errorNotice}`}>
          <strong>API unavailable</strong>
          <span>{platform.error}</span>
        </section>
      )}

      <section className={styles.setupGrid}>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">READINESS</span>
              <h2>Production configuration</h2>
            </div>
            <span className="pill">{hubspot?.configured ? 'Ready' : 'Pending'}</span>
          </div>

          <div className={styles.checkList}>
            {[
              ['HUBSPOT_CLIENT_ID', !missing.includes('HUBSPOT_CLIENT_ID')],
              ['HUBSPOT_CLIENT_SECRET', !missing.includes('HUBSPOT_CLIENT_SECRET')],
              ['HUBSPOT_REDIRECT_URI', !missing.includes('HUBSPOT_REDIRECT_URI')],
              ['ENCRYPTION_KEY', !missing.includes('ENCRYPTION_KEY')]
            ].map(([label, ready]) => (
              <div className={styles.checkRow} key={label}>
                <span className={`${styles.checkIcon} ${ready ? styles.ready : ''}`}>{ready ? '✓' : '·'}</span>
                <code>{label}</code>
                <strong>{ready ? 'Configured' : 'Required'}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">REQUIRED SCOPES</span>
              <h2>Read-only by default</h2>
            </div>
          </div>

          <div className={styles.scopeList}>
            {(hubspot?.scopes ?? []).map((scope) => <code key={scope}>{scope}</code>)}
            {(hubspot?.optionalScopes ?? []).map((scope) => (
              <code className={styles.optionalScope} key={scope}>{scope} · optional</code>
            ))}
          </div>
        </article>
      </section>

      <section className={`panel ${styles.workflowPanel}`}>
        <span className="section-label">AUTOMATED SEQUENCE</span>
        <h2>What the platform does after authorization</h2>
        <div className={styles.workflowSteps}>
          {[
            ['01', 'Create workspace', 'Creates an isolated tenant configuration in PostgreSQL.'],
            ['02', 'Authorize HubSpot', 'Uses OAuth state protection and stores encrypted tokens.'],
            ['03', 'Discover portal', 'Reads properties, owners, deal pipelines, stages and custom schemas.'],
            ['04', 'Recommend mappings', 'Scores custom properties against business concepts such as Lead Quality.'],
            ['05', 'Approve configuration', 'Locks the selected property and optional value mapping for dashboard use.']
          ].map(([number, title, description]) => (
            <article key={number}>
              <span>{number}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
