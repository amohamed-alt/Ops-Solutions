import DashboardClient from './DashboardClient';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Live HubSpot revenue intelligence, pipeline health and SDR execution analytics.'
};

export default function DashboardPage() {
  return (
    <main className={`page-shell ${styles.shell}`}>
      <DashboardClient />
    </main>
  );
}
