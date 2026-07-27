import Link from 'next/link';

import styles from './page.module.css';

export const dynamic = 'force-dynamic';

async function getPlatformStatus() {
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://api:3001';

  try {
    const response = await fetch(`${apiUrl}/api/v1/platform`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    return {
      connected: true,
      data: await response.json()
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
}

const modules = [
  {
    title: 'Command Dashboard',
    description: 'Stable HubSpot revenue dashboard, sync status, drilldowns, saved views, exports and guarded enhanced rollout.',
    status: 'Live',
    href: '/dashboard'
  },
  {
    title: 'Analytics Builder',
    description: 'Report Builder, Dashboard Builder and recurring email schedules built on saved reporting views.',
    status: 'Live',
    href: '/builder'
  },
  {
    title: 'Ops Actions',
    description: 'Admin-only guarded HubSpot write actions: create tasks, update lifecycle stage and mark records as reviewed.',
    status: 'Live · reconnect required for writes',
    href: '/settings/actions'
  },
  {
    title: 'Billing & Lifecycle',
    description: 'Plan packaging, commercial readiness, uninstall foundation and export-first data lifecycle guardrails.',
    status: 'Foundation · provider not connected',
    href: '/settings/billing'
  },
  {
    title: 'Setup Center',
    description: 'Workspace onboarding, HubSpot OAuth, portal discovery, mapping and sync preparation.',
    status: 'Live',
    href: '/setup'
  }
];

const readiness = [
  { label: 'Production dashboard restored', state: 'Done' },
  { label: 'Builder and scheduled emails visible', state: 'Done' },
  { label: 'Guarded CRM write actions visible', state: 'Done' },
  { label: 'Product pages connected by navigation flow', state: 'Done' },
  { label: 'HubSpot write scopes on old workspaces', state: 'Needs reconnect' },
  { label: 'Stripe/Paddle live payments', state: 'Needs provider setup' },
  { label: 'Automated uninstall and hard deletion', state: 'Needs approval workflow' },
  { label: 'Timezone and webhook hardening', state: 'Next engineering slice' }
];

const flows = [
  {
    step: '1',
    title: 'Connect and verify',
    body: 'Start in Setup to confirm HubSpot OAuth, mapping and sync health.'
  },
  {
    step: '2',
    title: 'Read the business',
    body: 'Use Dashboard to read KPIs, drilldowns and data freshness before taking action.'
  },
  {
    step: '3',
    title: 'Build repeatable reporting',
    body: 'Use Builder to create report definitions, dashboards and scheduled executive emails.'
  },
  {
    step: '4',
    title: 'Act with control',
    body: 'Use Ops Actions only after reconnecting write scopes and validating the CRM record.'
  },
  {
    step: '5',
    title: 'Package and sell',
    body: 'Use Billing to position plans, lifecycle guardrails and the remaining provider setup.'
  }
];

export default async function HomePage() {
  const platform = await getPlatformStatus();
  const hubspotConfigured = Boolean(platform.data?.hubspot?.configured);

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <div className="eyebrow">OPS SOLUTIONS · LAUNCH READINESS</div>
          <h1>One connected HubSpot revenue intelligence product.</h1>
          <p className="hero-copy">
            The project now has a stable command dashboard, builder, scheduled email reporting,
            guarded write actions, commercial packaging and a clear flow between every product area.
          </p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryLink} href="/dashboard">Open dashboard</Link>
            <Link className={styles.secondaryLink} href="/builder">Open builder</Link>
          </div>
        </div>

        <div className={`status-card ${platform.connected ? 'healthy' : 'unhealthy'}`}>
          <span className="status-dot" />
          <div>
            <strong>{platform.connected ? 'Platform services healthy' : 'API unavailable'}</strong>
            <span>
              {platform.connected
                ? `HubSpot configuration is ${hubspotConfigured ? 'ready' : 'waiting for credentials'}.`
                : platform.error}
            </span>
          </div>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Product entry points">
        <article className="metric-card">
          <span>Core</span>
          <strong>Dashboard</strong>
          <small>KPIs, drilldowns and sync status</small>
        </article>
        <article className="metric-card">
          <span>Builder</span>
          <strong>Reports</strong>
          <small>Dashboards and email schedules</small>
        </article>
        <article className="metric-card">
          <span>Actions</span>
          <strong>Guarded write</strong>
          <small>Tasks, lifecycle and review markers</small>
        </article>
        <article className="metric-card">
          <span>Commercial</span>
          <strong>Plans</strong>
          <small>Billing and lifecycle readiness</small>
        </article>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">PRODUCT MAP</span>
              <h2>Where every feature lives</h2>
            </div>
            <span className="pill">Launch view</span>
          </div>

          <div className="module-list">
            {modules.map((module) => (
              <Link className={styles.moduleLink} href={module.href} key={module.title}>
                <div>
                  <h3>{module.title}</h3>
                  <p>{module.description}</p>
                </div>
                <span>{module.status}</span>
              </Link>
            ))}
          </div>
        </div>

        <aside className="panel action-panel">
          <span className="section-label">Recommended flow</span>
          <h2>What to do from here</h2>
          <div className={styles.flowList}>
            {flows.map((flow) => (
              <article key={flow.step} className={styles.flowStep}>
                <strong>{flow.step}</strong>
                <div>
                  <h3>{flow.title}</h3>
                  <p>{flow.body}</p>
                </div>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="section-label">READINESS CHECKLIST</span>
            <h2>Done vs what still needs external setup</h2>
          </div>
          <span className="pill">Truthful launch state</span>
        </div>
        <div className={styles.readinessGrid}>
          {readiness.map((item) => (
            <article key={item.label} className={styles.readinessCard}>
              <strong>{item.label}</strong>
              <span>{item.state}</span>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
