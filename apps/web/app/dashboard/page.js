import { Dashboard } from '@/components/sdr/Dashboard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'SDR Command Center · Ops Intelligence',
  description: 'Live HubSpot SDR performance, attribution and operational intelligence.'
};

export default function DashboardPage() {
  return <Dashboard />;
}
