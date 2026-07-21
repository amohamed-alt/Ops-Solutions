import Link from 'next/link';

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
    title: 'HubSpot Connection',
    description: 'OAuth authorization, encrypted tokens and scope-aware portal connections.',
    status: 'Built'
  },
  {
    title: 'Portal Discovery',
    description: 'Properties, owners, pipelines, stages and optional custom objects.',
    status: 'Built'
  },
  {
    title: 'Semantic Mapping',
    description: 'Map Rank, Tier and custom properties into one reusable analytics model.',
    status: 'Built'
  },
  {
    title: 'Dashboard Engine',
    description: 'Reusable metrics, filters, drill-down and smart templates.',
    status: 'Next'
  }
];

export default async function HomePage() {
  const platform = await getPlatformStatus();
  const hubspotConfigured = Boolean(platform.data?.hubspot?.configured);

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <div className="eyebrow">OPS SOLUTIONS · HUBSPOT INTELLIGENCE</div>
          <h1>Analytics that adapts to every HubSpot portal.</h1>
          <p className="hero-copy">
            The platform can securely connect a portal, inspect its custom CRM structure and
            recommend how each property should map into reusable dashboard concepts.
          </p>
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

      <section className="metrics-grid" aria-label="Platform status">
        <article className="metric-card">
          <span>Connection</span>
          <strong>OAuth</strong>
          <small>Encrypted refreshable tokens</small>
        </article>
        <article className="metric-card">
          <span>Discovery</span>
          <strong>CRM Schema</strong>
          <small>Properties, owners and pipelines</small>
        </article>
        <article className="metric-card">
          <span>Intelligence</span>
          <strong>Semantic</strong>
          <small>Rank, Tier and custom fields</small>
        </article>
        <article className="metric-card">
          <span>Persistence</span>
          <strong>PostgreSQL</strong>
          <small>Tenant-isolated configuration</small>
        </article>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">PRODUCT MODULES</span>
              <h2>Connection and interpretation layer</h2>
            </div>
            <span className="pill">Foundation v0.2</span>
          </div>

          <div className="module-list">
            {modules.map((module) => (
              <article className="module-row" key={module.title}>
                <div>
                  <h3>{module.title}</h3>
                  <p>{module.description}</p>
                </div>
                <span>{module.status}</span>
              </article>
            ))}
          </div>
        </div>

        <aside className="panel action-panel">
          <span className="section-label">SETUP CENTER</span>
          <h2>Prepare the first HubSpot portal</h2>
          <p>
            Review configuration readiness, create the first workspace and follow the exact
            OAuth and discovery sequence.
          </p>
          <ol>
            <li>Configure production secrets</li>
            <li>Create the HubSpot OAuth app</li>
            <li>Connect and discover the portal</li>
            <li>Approve semantic mappings</li>
          </ol>
          <Link className="primary-link" href="/setup">Open setup center</Link>
        </aside>
      </section>
    </main>
  );
}
