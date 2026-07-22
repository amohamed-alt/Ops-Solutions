import Link from 'next/link';

import DashboardClient from './DashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  return (
    <main className={`page-shell ${styles.shell}`}>
      <nav className={styles.topbar}>
        <Link href="/">← Platform overview</Link>
        <div><Link href="/operations">Operations</Link><span className="pill">Smart SDR</span></div>
      </nav>
      <DashboardClient />
    </main>
  );
}
