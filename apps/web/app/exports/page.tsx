import { ExportCenter } from './ExportCenter';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Report Exports · Ops Intelligence',
  description: 'Secure tenant-scoped CSV exports for HubSpot revenue and SDR reporting.'
};

export default function ExportsPage() {
  return <ExportCenter />;
}
