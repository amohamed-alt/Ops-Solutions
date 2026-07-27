'use client';

import { AlertTriangle, CheckCircle2, CreditCard, DatabaseZap, Download, PlugZap, ShieldCheck, Trash2 } from 'lucide-react';

import './command-center-v2.css';

const plans = [
  {
    name: 'Intelligence',
    price: 'Manual pricing',
    description: 'Read-only HubSpot dashboards, drilldowns, saved views, and exports.',
    features: ['CRM analytics', 'Saved views', 'CSV/XLSX exports', 'Sync status']
  },
  {
    name: 'Builder',
    price: 'Manual pricing',
    description: 'Report Builder, Dashboard Builder, and scheduled executive reporting.',
    features: ['Report Builder', 'Dashboard Builder', 'Email scheduling', 'Template library']
  },
  {
    name: 'Automation',
    price: 'Manual pricing',
    description: 'Guarded HubSpot write actions with admin control and audit logging.',
    features: ['Create tasks', 'Update lifecycle stage', 'Mark reviewed', 'Audit log']
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Advanced security, custom onboarding, and tenant-specific reporting packages.',
    features: ['Custom scopes', 'Dedicated onboarding', 'Advanced governance', 'Priority support']
  }
];

const lifecycleItems = [
  { title: 'HubSpot uninstall handling', status: 'Foundation ready', description: 'Documented lifecycle flow for disconnecting OAuth and stopping future syncs.' },
  { title: 'Data deletion request', status: 'Manual approval required', description: 'Designed as an admin-controlled workflow before hard deletion is automated.' },
  { title: 'Export before delete', status: 'Uses existing exports', description: 'Customers can export reporting data before lifecycle actions are finalized.' },
  { title: 'Billing provider', status: 'Not connected', description: 'Stripe/Paddle keys are not configured yet, so this page is provider-neutral.' }
];

function Panel({ title, description, icon: Icon, children }: { title: string; description: string; icon: typeof CreditCard; children: React.ReactNode }) {
  return (
    <section className="cc2-panel ric-panel">
      <header>
        <div>
          <h2><Icon size={18} /> {title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="cc2-panel-body" style={{ display: 'grid', gap: 14 }}>{children}</div>
    </section>
  );
}

export function BillingLifecycleClient() {
  return (
    <main className="cc2-shell" style={{ padding: 28 }}>
      <section className="cc2-hero ric-hero">
        <div>
          <span><CreditCard size={16} /> BILLING & DATA LIFECYCLE</span>
          <h1>Plans, billing readiness, uninstall, and data deletion foundation</h1>
          <p>Prepare the SaaS commercial layer without exposing secrets or enabling destructive actions before approval workflows are implemented.</p>
        </div>
      </section>

      <div className="dashboard-rollout-recovery" role="status">
        <div>
          <span><AlertTriangle size={17} /></span>
          <div>
            <strong>Payment provider not connected yet.</strong>
            <p>Plans are visible for packaging and sales readiness. Live card payments require a future Stripe/Paddle connection and signed billing webhooks.</p>
          </div>
        </div>
      </div>

      <Panel title="Plans" description="Commercial packaging for the SaaS product." icon={CreditCard}>
        <div className="cc2-grid two">
          {plans.map((plan) => (
            <article className="cc2-company-card" key={plan.name}>
              <strong>{plan.name}</strong>
              <span>{plan.price}</span>
              <p>{plan.description}</p>
              <ul>
                {plan.features.map((feature) => <li key={feature}><CheckCircle2 size={13} /> {feature}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Data lifecycle" description="Safe account lifecycle controls before destructive automation is enabled." icon={DatabaseZap}>
        {lifecycleItems.map((item) => (
          <article className="cc2-company-card" key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.status}</span>
            <p>{item.description}</p>
          </article>
        ))}
      </Panel>

      <Panel title="Operational guardrails" description="What must happen before live billing and automated deletion are switched on." icon={ShieldCheck}>
        <div className="cc2-grid two">
          <article className="cc2-company-card">
            <strong><PlugZap size={15} /> Provider integration</strong>
            <p>Add signed billing webhooks, plan lookup, subscription state, failed-payment handling, and audit events before charging customers.</p>
          </article>
          <article className="cc2-company-card">
            <strong><Trash2 size={15} /> Destructive actions</strong>
            <p>Require owner approval, confirmation text, export-first option, and audit logs before any customer data deletion is automated.</p>
          </article>
          <article className="cc2-company-card">
            <strong><Download size={15} /> Export first</strong>
            <p>Use existing report exports and scheduled report outputs as the first export path before delete/deauthorize actions.</p>
          </article>
          <article className="cc2-company-card">
            <strong><ShieldCheck size={15} /> Access control</strong>
            <p>Billing and data lifecycle actions should remain owner/admin-only and never run from unauthenticated or public routes.</p>
          </article>
        </div>
      </Panel>
    </main>
  );
}
