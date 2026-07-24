import Link from 'next/link';

import { PublicPolicyLayout } from '@/components/legal/PublicPolicyLayout';

export const metadata = { title: 'Support · Ops Solutions', description: 'Support, incident and privacy request channels for Ops Solutions.' };

export default function SupportPage() {
  const sections = [
    { id: 'help', title: 'Get help', content: <><p>For workspace access, HubSpot connection, synchronization, mappings, dashboards, exports, retention imports, schedules or alert delivery, contact your workspace administrator first. Administrators can review connection state, audit history and configuration inside the product.</p><div className="legal-actions"><a className="legal-button" href="mailto:support@dashboardtalentera.tech?subject=Ops%20Solutions%20Support">Email support</a><Link className="legal-button secondary" href="/security">Security overview</Link></div></> },
    { id: 'include', title: 'What to include', content: <ul><li>Workspace or company name, but never passwords, tokens or secret values.</li><li>The page, report, object or workflow affected.</li><li>Approximate time and timezone of the issue.</li><li>Expected behavior and the message visible in the interface.</li><li>A screenshot with personal or confidential CRM data redacted where possible.</li></ul> },
    { id: 'priority', title: 'Priority guidance', content: <><p><strong>Critical:</strong> suspected tenant data exposure, authentication bypass or production-wide outage.</p><p><strong>High:</strong> failed HubSpot onboarding, synchronization unavailable for an active customer or dashboards inaccessible.</p><p><strong>Normal:</strong> report definition, mapping, usability, export or configuration questions.</p></> },
    { id: 'privacy', title: 'Privacy and deletion requests', content: <p>Verified privacy and deletion requests use the process documented on the <Link href="/data-deletion">Data Deletion page</Link>. HubSpot record requests should normally be submitted to the organization controlling the relevant HubSpot portal.</p> },
    { id: 'security-report', title: 'Security reports', content: <p>Send suspected vulnerabilities to <a href="mailto:security@dashboardtalentera.tech?subject=Ops%20Solutions%20Security%20Report">security@dashboardtalentera.tech</a>. Avoid accessing data that is not yours and do not disrupt production while testing. We will acknowledge credible reports and coordinate remediation.</p> },
    { id: 'availability', title: 'Availability and updates', content: <p>Planned maintenance and material incidents are communicated to affected customers through agreed operational channels. Scheduled reports and alerts include durable delivery history so administrators can distinguish report generation failures from email provider failures.</p> }
  ];
  return <PublicPolicyLayout eyebrow="Support" title="A clear path from question to resolution." summary="Support guidance for customer administrators, end users, privacy contacts and security researchers." sections={sections} />;
}
