import { DashboardCommandCenterRollout } from '@/components/sdr/DashboardCommandCenterRollout';
import { PdfSnapshotAction } from '@/components/sdr/PdfSnapshotAction';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Focused HubSpot revenue, SDR, pipeline, team and data-quality intelligence.'
};

const labelAwareEnabled = process.env.LABEL_AWARE_COMMAND_CENTER === 'true';

// CommandCenterV2 remains the stable production default inside DashboardCommandCenterRollout.
export default function DashboardPage() {
  return (
    <>
      <DashboardCommandCenterRollout labelAwareEnabled={labelAwareEnabled} />
      <PdfSnapshotAction />
    </>
  );
}
