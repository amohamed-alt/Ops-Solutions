import { DashboardWorkspaceExperience } from '@/components/sdr/DashboardWorkspaceExperience';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Filtered HubSpot revenue, SDR, pipeline, source, team and data-quality intelligence.'
};

export default function DashboardPage() {
  return <DashboardWorkspaceExperience />;
}
