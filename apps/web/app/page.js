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
    description: 'OAuth, portal discovery and scope validation.',
    status: 'Next'
  },
  {
    title: 'Semantic Mapping',
    description: 'Map Rank, Tier and custom properties into one analytics model.',
    status: 'Planned'
  },
  {
    title: 'Sync Engine',
    description: 'Reliable initial and incremental CRM synchronization.',
    status: 'Queue Ready'
  },
  {
    title: 'Dashboard Engine',
    description: 'Reusable metrics, filters, drill-down and smart templates.',
    status: 'Planned'
  }
];

export default async function HomePage() {
  const platform = await getPlatformStatus();

  return (
    <main className="page-shell">
      <section className="hero">
        <div>
          <div className="eyebrow">OPS SOLUTIONS · PLATFORM FOUNDATION</div>
          <h1>Intelligent HubSpot analytics, built to adapt.</h1>
          <p className="hero-copy">
            The production foundation is online. The next milestone connects a HubSpot portal,
            discovers its schema and builds dashboards around each customer&apos;s own properties.
          </p>
        </div>

        <div className={`status-card ${platform.connected ? 'healthy' : 'unhealthy'}`}>
          <span className="status-dot" />
          <div>
            <strong>{platform.connected ? 'Platform services healthy' : 'API unavailable'}</strong>
            <span>
              {platform.connected
                ? 'Web, API, PostgreSQL, Redis and worker runtime are connected.'
                : platform.error}
            </span>
          </div>
        </div>
      </section>

      <section className="metrics-grid" aria-label="Platform status">
        <article className="metric-card">
          <span>Runtime</span>
          <strong>Docker</strong>
          <small>Automatic deployment</small>
        </article>
        <article className="metric-card">
          <span>Database</span>
          <strong>PostgreSQL</strong>
          <small>Persistent CRM analytics</small>
        </article>
        <article className="metric-card">
          <span>Queue</span>
          <strong>BullMQ</strong>
          <small>HubSpot sync jobs</small>
        </article>
        <article className="metric-card">
          <span>Cache</span>
          <strong>Redis</strong>
          <small>Fast and controlled workloads</small>
        </article>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="section-label">BUILD ROADMAP</span>
              <h2>Core product modules</h2>
            </div>
            <span className="pill">Foundation v0.1</span>
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
          <span className="section-label">NEXT MILESTONE</span>
          <h2>Connect the first HubSpot portal</h2>
          <p>
            Add secure OAuth, discover CRM objects and properties, then generate the first
            mapping recommendations for Rank, Tier and Lead Quality.
          </p>
          <ol>
            <li>Create HubSpot OAuth app</li>
            <li>Store encrypted connection tokens</li>
            <li>Scan properties, pipelines and owners</li>
            <li>Open the mapping approval wizard</li>
          </ol>
        </aside>
      </section>
    </main>
  );
}
