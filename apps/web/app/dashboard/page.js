import { CommandCenterV2 as StableCommandCenter } from '@/components/sdr/CommandCenterV2';
import { RevenueCommandCenter as LabelAwareCommandCenter } from '@/components/sdr/RevenueCommandCenter';
import { PdfSnapshotAction } from '@/components/sdr/PdfSnapshotAction';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Focused HubSpot revenue, SDR, pipeline, team and data-quality intelligence.'
};

const CommandCenter = process.env.LABEL_AWARE_COMMAND_CENTER === 'true'
  ? LabelAwareCommandCenter
  : StableCommandCenter;

export default function DashboardPage() {
  return (
    <>
      <CommandCenter />
      <PdfSnapshotAction />
    </>
  );
}
