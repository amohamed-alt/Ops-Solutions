import { notFound } from 'next/navigation';

import { ObjectDashboardPageClient } from '@/components/sdr/ObjectDashboardPageClient';

export const dynamic = 'force-dynamic';

type ObjectDashboardType = 'contacts' | 'companies' | 'deals' | 'calls' | 'meetings' | 'tasks' | 'tickets';

const TYPE_SET = new Set<string>([
  'contacts',
  'companies',
  'deals',
  'calls',
  'meetings',
  'tasks',
  'tickets'
]);

function isObjectDashboardType(value: string): value is ObjectDashboardType {
  return TYPE_SET.has(value);
}

export async function generateMetadata({ params }: { params: Promise<{ objectType: string }> }) {
  const { objectType } = await params;
  const label = objectType.charAt(0).toUpperCase() + objectType.slice(1);
  return {
    title: `${label} Dashboard · Ops Intelligence`,
    description: `Live tenant-isolated HubSpot ${objectType} reports, drill-downs and CRM record links.`
  };
}

export default async function ObjectDashboardPage({ params }: { params: Promise<{ objectType: string }> }) {
  const { objectType } = await params;
  if (!isObjectDashboardType(objectType)) notFound();
  return <ObjectDashboardPageClient objectType={objectType} />;
}
