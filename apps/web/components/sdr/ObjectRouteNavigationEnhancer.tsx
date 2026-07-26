'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Database,
  Gauge,
  Settings2,
  Target,
  type LucideIcon
} from 'lucide-react';

type SectionLink = {
  label: string;
  sectionId?: string;
  href?: string;
};

type NavigationGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  sectionId?: string;
  href?: string;
  defaultOpen?: boolean;
  children?: SectionLink[];
};

const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: Gauge,
    sectionId: 'overview'
  },
  {
    id: 'revenue',
    label: 'Revenue',
    icon: CircleDollarSign,
    defaultOpen: true,
    children: [
      { label: 'Pipeline & revenue', sectionId: 'pipeline' },
      { label: 'Executive overview', sectionId: 'overview' }
    ]
  },
  {
    id: 'acquisition',
    label: 'Acquisition',
    icon: Target,
    children: [
      { label: 'Activity performance', sectionId: 'activity' },
      { label: 'Sources & markets', sectionId: 'sources' },
      { label: 'Team performance', sectionId: 'team' }
    ]
  },
  {
    id: 'retention',
    label: 'Retention',
    icon: BriefcaseBusiness,
    href: '/dashboard/retention-budget'
  },
  {
    id: 'crm-data',
    label: 'CRM Data',
    icon: Database,
    children: [
      { label: 'All CRM objects', href: '/dashboard/all-objects' },
      { label: 'Contacts', href: '/dashboard/objects/contacts' },
      { label: 'Companies', href: '/dashboard/objects/companies' },
      { label: 'Deals', href: '/dashboard/objects/deals' },
      { label: 'Calls', href: '/dashboard/objects/calls' },
      { label: 'Meetings', href: '/dashboard/objects/meetings' },
      { label: 'Tasks', href: '/dashboard/objects/tasks' },
      { label: 'Tickets', href: '/dashboard/objects/tickets' }
    ]
  },
  {
    id: 'administration',
    label: 'Administration',
    icon: Settings2,
    children: [
      { label: 'Workspace settings', href: '/settings/workspace' },
      { label: 'Mappings', href: '/settings/mappings' },
      { label: 'Data SLA', href: '/settings/data-sla' },
      { label: 'Scheduled reports', href: '/settings/reports' },
      { label: 'Operational alerts', href: '/settings/alerts' },
      { label: 'Billing & usage', href: '/settings/billing' },
      { label: 'Security', href: '/settings/security' },
      { label: 'Production readiness', href: '/settings/readiness' }
    ]
  }
];

const SECTION_IDS = ['overview', 'activity', 'pipeline', 'sources', 'team', 'quality'];

function scrollToSection(sectionId: string) {
  const target = document.getElementById(sectionId);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${sectionId}`);
}

function NavigationChild({ item, onSection }: { item: SectionLink; onSection: (sectionId: string) => void }) {
  if (item.href) {
    return (
      <a href={item.href} className="command-center-nav-child">
        <span>{item.label}</span>
        <ChevronRight size={13} aria-hidden="true" />
      </a>
    );
  }

  return (
    <button type="button" className="command-center-nav-child" onClick={() => item.sectionId && onSection(item.sectionId)}>
      <span>{item.label}</span>
      <ChevronRight size={13} aria-hidden="true" />
    </button>
  );
}

export function ObjectRouteNavigationEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    const locate = () => {
      const nav = document.querySelector<HTMLElement>('.dashboard-workspace-experience .ric-sidebar nav');
      if (nav) setTarget(nav);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!target) return;
    const sections = SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter((section): section is HTMLElement => Boolean(section));
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: '-18% 0px -66% 0px', threshold: [0.05, 0.25, 0.5] }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [target]);

  if (!target) return null;

  const navigation = (
    <div className="command-center-navigation" data-command-center-navigation>
      <span className="command-center-navigation-label">WORKSPACE</span>
      {NAVIGATION_GROUPS.map(({ id, label, icon: Icon, sectionId, href, children, defaultOpen }) => {
        if (children?.length) {
          const containsActive = children.some((child) => child.sectionId === activeSection);
          return (
            <details key={id} className={containsActive ? 'active' : ''} defaultOpen={defaultOpen || containsActive}>
              <summary>
                <Icon size={16} aria-hidden="true" />
                <span>{label}</span>
                <ChevronRight className="command-center-nav-chevron" size={14} aria-hidden="true" />
              </summary>
              <div className="command-center-nav-children">
                {children.map((child) => (
                  <NavigationChild key={`${id}-${child.label}`} item={child} onSection={(next) => {
                    setActiveSection(next);
                    scrollToSection(next);
                  }} />
                ))}
              </div>
            </details>
          );
        }

        if (href) {
          return (
            <a key={id} href={href} className="command-center-nav-main">
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </a>
          );
        }

        return (
          <button
            key={id}
            type="button"
            className={`command-center-nav-main ${activeSection === sectionId ? 'active' : ''}`}
            onClick={() => {
              if (!sectionId) return;
              setActiveSection(sectionId);
              scrollToSection(sectionId);
            }}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{label}</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        );
      })}
      <div className="command-center-navigation-footer">
        <Building2 size={15} aria-hidden="true" />
        <span>Company-scoped analytics</span>
      </div>
    </div>
  );

  return createPortal(navigation, target);
}
