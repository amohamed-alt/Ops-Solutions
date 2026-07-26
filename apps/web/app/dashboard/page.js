import { CommandCenterV2 } from '@/components/sdr/CommandCenterV2';
import { PdfSnapshotAction } from '@/components/sdr/PdfSnapshotAction';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Focused HubSpot revenue, SDR, pipeline, team and data-quality intelligence.'
};

export default function DashboardPage() {
  return (
    <>
      <CommandCenterV2 />
      <PdfSnapshotAction />
    </>
  );
}
