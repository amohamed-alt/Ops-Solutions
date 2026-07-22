import OnboardingClient from './OnboardingClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Connect HubSpot · Ops Intelligence',
  description: 'Create a company workspace, connect HubSpot and generate a live revenue command center.'
};

export default function OnboardingPage() {
  return <OnboardingClient />;
}
