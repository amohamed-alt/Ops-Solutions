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

export function ObjectRouteNavigationEnhancer() {
  useEffect(() => {
    let createdGroup: HTMLElement | null = null;

    const install = () => {
      const nav = document.querySelector<HTMLElement>('.dashboard-workspace-experience .ric-sidebar nav');
      if (!nav || nav.querySelector('[data-object-route-group]')) return;

      const group = document.createElement('section');
      group.className = 'object-route-nav-group';
      group.dataset.objectRouteGroup = 'true';

      const heading = document.createElement('span');
      heading.className = 'object-route-nav-heading';
      heading.textContent = 'OBJECT DASHBOARDS';
      group.append(heading);

      for (const [type, label] of OBJECT_ROUTES) {
        const link = document.createElement('a');
        link.href = `/dashboard/objects/${type}`;
        link.className = 'object-route-nav-link';
        link.innerHTML = `<span aria-hidden="true">${label.charAt(0)}</span><b>${label}</b><i aria-hidden="true">›</i>`;
        group.append(link);
      }

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
