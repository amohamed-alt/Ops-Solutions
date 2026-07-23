import { EnterpriseRevenueWorkspace } from '@/components/sdr/EnterpriseRevenueWorkspace';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Operating System · Ops Intelligence',
  description: 'Role-based HubSpot revenue forecasting, risk scoring, SDR execution, team performance and RevOps data health.'
};

export default function DashboardPage() {
  return <EnterpriseRevenueWorkspace />;
}
