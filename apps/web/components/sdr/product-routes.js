export const PRODUCT_ROUTES = Object.freeze([
  {
    key: 'readiness',
    label: 'Readiness',
    href: '/settings/readiness',
    description: 'Review launch blockers, readiness incidents, sync health, and required next actions.'
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    description: 'Read KPIs, drilldowns, and synchronized HubSpot analytics.'
  },
  {
    key: 'builder',
    label: 'Builder',
    href: '/builder',
    description: 'Create reports, dashboards, and email schedules.'
  },
  {
    key: 'actions',
    label: 'Ops Actions',
    href: '/settings/actions',
    description: 'Create tasks, update lifecycle, and review records.'
  },
  {
    key: 'billing',
    label: 'Billing',
    href: '/settings/billing',
    description: 'Package plans, lifecycle, billing readiness, and deletion flow.'
  },
  {
    key: 'setup',
    label: 'Setup',
    href: '/setup',
    description: 'Connect workspaces, HubSpot, mappings, and sync settings.'
  }
]);

export const PRODUCT_FLOW = Object.freeze([
  'Setup',
  'Readiness',
  'Dashboard',
  'Builder',
  'Email schedule',
  'Ops Actions',
  'Billing/Data lifecycle'
]);

export function productRoute(key) {
  return PRODUCT_ROUTES.find((route) => route.key === key) ?? null;
}

export function productFlowLabel() {
  return `Recommended flow: ${PRODUCT_FLOW.join(' → ')}.`;
}
