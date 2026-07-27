import { OpsActionsClient } from '@/components/sdr/OpsActionsClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Ops Actions | Ops Solutions',
  description: 'Guarded HubSpot write actions for tasks, lifecycle stages, and reviewed records.'
};

export default function OpsActionsPage() {
  return <OpsActionsClient />;
}
