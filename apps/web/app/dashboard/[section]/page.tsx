import { notFound, redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const SECTION_ROUTES: Record<string, string> = {
  executive: '/dashboard#overview',
  pipeline: '/dashboard#pipeline',
  activities: '/dashboard#activity',
  sources: '/dashboard#sources',
  team: '/dashboard#team',
  revops: '/dashboard#quality',
  retention: '/dashboard#retention',
  contacts: '/dashboard/objects/contacts',
  companies: '/dashboard/objects/companies',
  deals: '/dashboard/objects/deals',
  calls: '/dashboard/objects/calls',
  meetings: '/dashboard/objects/meetings',
  tasks: '/dashboard/objects/tasks',
  tickets: '/dashboard/objects/tickets'
};

export default async function DashboardSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const target = SECTION_ROUTES[section];
  if (!target) notFound();
  redirect(target);
}
