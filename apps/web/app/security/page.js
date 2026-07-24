import Link from 'next/link';

import { PublicPolicyLayout } from '@/components/legal/PublicPolicyLayout';

export const metadata = { title: 'Security Overview · Ops Solutions', description: 'Security architecture and operational safeguards for Ops Solutions.' };

export default function SecurityPage() {
  const sections = [
    { id: 'architecture', title: 'Security architecture', content: <ul><li>Tenant isolation is enforced by authenticated workspace membership and workspace-scoped queries.</li><li>HubSpot OAuth tokens are encrypted using authenticated encryption before database storage.</li><li>PostgreSQL and Redis are private application services and are not exposed to the public internet.</li><li>The production analytics integration is read-only against customer HubSpot records.</li></ul> },
    { id: 'identity', title: 'Identity and access', content: <><p>Customer accounts use secure password hashing, expiring sessions, role-based workspace permissions and audit logging. Workspace owners control invitations and role changes. Security Center features support session revocation, trusted-device management and unusual-login notifications.</p><p>Administrative service credentials are isolated from customer sessions and never returned through the product interface.</p></> },
    { id: 'delivery', title: 'Software delivery', content: <ul><li>Every pull request is validated across API, worker, web application, HubSpot configuration and Docker Compose.</li><li>Tracked files are scanned for credentials and production dependencies are audited.</li><li>Runtime configuration is checked without printing secret values.</li><li>Production deployments preserve server-only secrets, verify backups and automatically roll back failed candidate releases.</li></ul> },
    { id: 'data', title: 'Data protection and resilience', content: <><p>Data transfers use HTTPS. Credentials and sensitive session material are not logged. Export artifacts are bounded and expire. Synchronization and reporting workloads use idempotency, pagination, concurrency control and tenant-aware caching.</p><p>Backup freshness, database integrity and service health are monitored using production runbooks.</p></> },
    { id: 'providers', title: 'Third-party providers', content: <p>Ops Solutions relies on HubSpot and selected infrastructure, database, email and monitoring providers. Provider access is limited to the purpose required to operate the service. Email delivery is disabled unless a verified provider configuration is present.</p> },
    { id: 'reporting', title: 'Report a security concern', content: <><p>Do not include passwords, OAuth tokens, session cookies or customer CRM exports in an initial report. Provide a concise description, affected route or feature, reproduction steps and expected impact through the channels listed on the <Link href="/support">Support page</Link>.</p><div className="legal-callout">We prioritize credible reports that could affect authentication, tenant isolation, data confidentiality or production availability.</div></> }
  ];
  return <PublicPolicyLayout eyebrow="Security" title="Defense in depth for connected revenue data." summary="A public overview of the technical and operational safeguards used to protect customer accounts, synchronized HubSpot data and production delivery." sections={sections} />;
}
