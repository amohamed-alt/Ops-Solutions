import { DashboardProductShell } from '@/components/sdr/DashboardProductShell';
import '@/components/sdr/dashboard-layout-fix.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Filtered HubSpot revenue, SDR, pipeline, source, team and data-quality intelligence.'
};

export default function DashboardPage() {
  // DashboardProductShell composes DashboardWorkspaceExperience and adds safe product-level enhancements.
  return <DashboardProductShell />;
}
