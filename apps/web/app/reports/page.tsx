import ReportsDashboard from './ReportsDashboard';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Reporting · Ops Intelligence',
  description: 'Filtered HubSpot revenue, SDR, pipeline, attribution and data-quality reporting.'
};

export default function ReportsPage() {
  return <ReportsDashboard />;
}
