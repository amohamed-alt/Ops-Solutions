import { notFound } from 'next/navigation';

import { ExtendedObjectExplorerClient } from '@/components/sdr/ExtendedObjectExplorerClient';

export const dynamic = 'force-dynamic';

const OBJECT_TYPE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

export async function generateMetadata({ params }: { params: Promise<{ objectType: string }> }) {
  const { objectType } = await params;
  const label = objectType.replace(/^\d+-/, '').replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  return {
    title: `${label} Dashboard · Ops Intelligence`,
    description: `Server-filtered HubSpot ${label} records, diagnostics and bounded CSV exports.`
  };
}

export default async function DynamicObjectDashboardPage({ params }: { params: Promise<{ objectType: string }> }) {
  const { objectType } = await params;
  if (!OBJECT_TYPE_PATTERN.test(objectType)) notFound();
  return <ExtendedObjectExplorerClient objectType={objectType.toLowerCase()} />;
}
