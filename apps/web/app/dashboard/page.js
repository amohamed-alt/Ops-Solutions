import { DashboardProductShell } from '@/components/sdr/DashboardProductShell';
import { ObjectIntelligenceWorkspace } from '@/components/sdr/ObjectIntelligenceWorkspace';
import { ObjectRouteNavigationEnhancer } from '@/components/sdr/ObjectRouteNavigationEnhancer';
import { PdfSnapshotAction } from '@/components/sdr/PdfSnapshotAction';
import '@/components/sdr/dashboard-layout-fix.css';
import '@/components/sdr/dashboard-saas-refresh.css';
import '@/components/sdr/object-route-navigation.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Revenue Command Center · Ops Intelligence',
  description: 'Filtered HubSpot revenue, SDR, pipeline, object, team and data-quality intelligence.'
};

export default function DashboardPage() {
  // DashboardProductShell keeps DashboardWorkspaceExperience as the production command-center foundation.
  return (
    <>
      <DashboardProductShell />
      <ObjectIntelligenceWorkspace />
      <ObjectRouteNavigationEnhancer />
      <PdfSnapshotAction />
    </>
  );
}
