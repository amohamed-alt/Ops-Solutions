import Link from 'next/link';

import OperationsClient from './OperationsClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default function OperationsPage() {
  return (
    <main className={`page-shell ${styles.operationsShell}`}>
      <nav className={styles.topbar}>
        <Link href="/">← Platform overview</Link>
        <div>
          <Link href="/setup">Setup</Link>
          <span className="pill">Operations</span>
        </div>
      </nav>
      <OperationsClient />
    </main>
  );
}
