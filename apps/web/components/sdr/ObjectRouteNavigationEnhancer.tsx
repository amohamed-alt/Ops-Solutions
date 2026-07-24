'use client';

import { useEffect } from 'react';

const OBJECT_ROUTES = [
  ['contacts', 'Contacts'],
  ['companies', 'Companies'],
  ['deals', 'Deals'],
  ['calls', 'Calls'],
  ['meetings', 'Meetings'],
  ['tasks', 'Tasks'],
  ['tickets', 'Tickets']
] as const;

const OPERATIONS_ROUTES = [
  ['/dashboard/retention-budget', 'Retention Budget', 'R'],
  ['/settings/reports', 'Scheduled Reports', 'S'],
  ['/settings/billing', 'Plans & Usage', '$']
] as const;

function navLink(href: string, label: string, glyph: string, className = 'object-route-nav-link') {
  const link = document.createElement('a');
  link.href = href;
  link.className = className;
  link.innerHTML = `<span aria-hidden="true">${glyph}</span><b>${label}</b><i aria-hidden="true">›</i>`;
  return link;
}

export function ObjectRouteNavigationEnhancer() {
  useEffect(() => {
    let createdGroup: HTMLElement | null = null;

    const install = () => {
      const nav = document.querySelector<HTMLElement>('.dashboard-workspace-experience .ric-sidebar nav');
      if (!nav || nav.querySelector('[data-object-route-group]')) return;

      const group = document.createElement('section');
      group.className = 'object-route-nav-group';
      group.dataset.objectRouteGroup = 'true';

      const objectHeading = document.createElement('span');
      objectHeading.className = 'object-route-nav-heading';
      objectHeading.textContent = 'OBJECT DASHBOARDS';
      group.append(objectHeading);
      group.append(navLink('/dashboard/all-objects', 'All CRM Objects', '∞', 'object-route-nav-link object-route-nav-all'));

      for (const [type, label] of OBJECT_ROUTES) {
        group.append(navLink(`/dashboard/objects/${type}`, label, label.charAt(0)));
      }

      const operationsHeading = document.createElement('span');
      operationsHeading.className = 'object-route-nav-heading';
      operationsHeading.textContent = 'OPERATIONS';
      group.append(operationsHeading);
      for (const [href, label, glyph] of OPERATIONS_ROUTES) group.append(navLink(href, label, glyph));

      nav.append(group);
      createdGroup = group;
    };

    install();
    const observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      createdGroup?.remove();
    };
  }, []);

  return null;
}
