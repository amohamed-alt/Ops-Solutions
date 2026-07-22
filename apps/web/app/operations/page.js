import Link from 'next/link';

import OperationsClient from './OperationsClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

async function loadOperations() {
  const apiUrl = process.env.API_INTERNAL_URL ?? 'http://api:3001';
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey) {
    return { workspaces: [], error: 'ADMIN_API_KEY is not configured for the web runtime.' };
  }

  try {
    const workspacesResponse = await fetch(`${apiUrl}/api/v1/workspaces`, {
      headers: { 'x-admin-key': adminKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000)
    });

    if (!workspacesResponse.ok) {
      throw new Error(`Workspace API returned ${workspacesResponse.status}`);
    }

    const workspacePayload = await workspacesResponse.json();
    const connected = (workspacePayload.results ?? []).filter((workspace) => workspace.hubspot_status === 'connected');
    const states = await Promise.all(connected.map(async (workspace) => {
      const response = await fetch(`${apiUrl}/api/v1/workspaces/${workspace.id}/sync`, {
        headers: { 'x-admin-key': adminKey },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        return {
          workspace,
          initialized: false,
          activeRun: null,
          latestRun: null,
          cursors: [],
          recordCounts: [],
          freshness: null,
          error: `Sync API returned ${response.status}`
        };
      }
      return response.json();
    }));

    return { workspaces: states, error: null };
  } catch (error) {
    return { workspaces: [], error: error.message };
  }
}

export default async function OperationsPage() {
  const data = await loadOperations();

  return (
    <main className={`page-shell ${styles.operationsShell}`}>
      <nav className={styles.topbar}>
        <Link href="/">← Platform overview</Link>
        <div>
          <Link href="/setup">Setup</Link>
          <span className="pill">Operations</span>
        </div>
      </nav>

      {data.error ? (
        <section className={styles.fatalState}>
          <span className="section-label">OPERATIONS UNAVAILABLE</span>
          <h1>Sync control center could not load.</h1>
          <p>{data.error}</p>
        </section>
      ) : (
        <OperationsClient initialWorkspaces={data.workspaces} />
      )}
    </main>
  );
}
