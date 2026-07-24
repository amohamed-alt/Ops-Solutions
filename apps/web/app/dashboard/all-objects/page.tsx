import { ExtendedObjectExplorerClient } from '@/components/sdr/ExtendedObjectExplorerClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'All CRM Objects · Ops Intelligence',
  description: 'Dynamic tenant-isolated reporting catalog for synchronized standard and custom HubSpot objects.'
};

export default function AllObjectsPage() {
  return <ExtendedObjectExplorerClient />;
}
