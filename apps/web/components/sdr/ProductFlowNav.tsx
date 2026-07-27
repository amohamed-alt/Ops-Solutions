'use client';

import Link from 'next/link';
import { ArrowRight, Route } from 'lucide-react';

import './command-center-v2.css';

type ProductFlowStep = {
  label: string;
  href: string;
  description: string;
  badge?: string;
};

const productNav = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', description: 'Read KPIs, drilldowns, and synced HubSpot analytics.' },
  { key: 'builder', label: 'Builder', href: '/builder', description: 'Create reports, dashboards, and email schedules.' },
  { key: 'actions', label: 'Ops Actions', href: '/settings/actions', description: 'Create tasks, update lifecycle, and review records.' },
  { key: 'billing', label: 'Billing', href: '/settings/billing', description: 'Package plans, lifecycle, billing readiness, and deletion flow.' },
  { key: 'setup', label: 'Setup', href: '/setup', description: 'Connect workspaces, HubSpot, mappings, and sync settings.' }
];

export function ProductFlowNav({
  current,
  purpose,
  nextSteps
}: {
  current: string;
  purpose: string;
  nextSteps: ProductFlowStep[];
}) {
  return (
    <section className="cc2-panel ric-panel" aria-label="Product navigation and page purpose">
      <header>
        <div>
          <h2><Route size={18} /> What this page does</h2>
          <p>{purpose}</p>
        </div>
      </header>
      <div className="cc2-panel-body" style={{ display: 'grid', gap: 18 }}>
        <div className="cc2-grid two" aria-label="Main product routes">
          {productNav.map((item) => {
            const active = item.key === current;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="cc2-company-card"
                style={{ textDecoration: 'none', borderColor: active ? 'rgba(20, 184, 166, 0.7)' : undefined }}
              >
                <strong>{item.label}</strong>
                <span>{active ? 'Current page' : item.href}</span>
                <p>{item.description}</p>
              </Link>
            );
          })}
        </div>

        <div className="cc2-empty" style={{ textAlign: 'left' }}>
          Recommended flow: Dashboard → Builder → Email schedule → Ops Actions → Billing/Data lifecycle.
        </div>

        <div className="cc2-grid two" aria-label="Recommended next actions">
          {nextSteps.map((step) => (
            <Link key={`${step.href}-${step.label}`} href={step.href} className="cc2-company-card" style={{ textDecoration: 'none' }}>
              <strong>{step.label} <ArrowRight size={14} /></strong>
              <span>{step.badge ?? 'Next step'}</span>
              <p>{step.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
