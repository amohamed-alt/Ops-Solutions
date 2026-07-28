import { BuilderSuiteClient } from '@/components/sdr/BuilderSuiteClient';
import { ScheduleMonitorClient } from '@/components/sdr/ScheduleMonitorClient';

export const dynamic = 'force-dynamic';

export default function BuilderPage() {
  return (
    <>
      <BuilderSuiteClient />
      <ScheduleMonitorClient />
    </>
  );
}
