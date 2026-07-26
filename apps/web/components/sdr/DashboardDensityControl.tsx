'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayoutGrid, List, Rows3 } from 'lucide-react';

type DensityMode = 'executive' | 'operational' | 'detailed';

const DENSITY_OPTIONS = [
  { id: 'executive', label: 'Executive', icon: LayoutGrid },
  { id: 'operational', label: 'Operational', icon: Rows3 },
  { id: 'detailed', label: 'Detailed', icon: List }
] as const;

const STORAGE_KEY = 'ops:dashboard-density';

function isDensityMode(value: string | null): value is DensityMode {
  return DENSITY_OPTIONS.some((option) => option.id === value);
}

function applyDensity(mode: DensityMode) {
  document.documentElement.dataset.dashboardDensity = mode;
}

function enhanceLongCopy() {
  const descriptions = document.querySelectorAll<HTMLElement>(
    '.dashboard-workspace-experience .ric-panel > header p, .dashboard-workspace-experience .dashboard-data-health p'
  );

  descriptions.forEach((description) => {
    if ((description.textContent?.trim().length ?? 0) < 84 || description.dataset.expandableCopy === 'true') return;
    description.dataset.expandableCopy = 'true';
    description.classList.add('command-center-expandable-copy');
    description.tabIndex = 0;
    description.setAttribute('role', 'button');
    description.setAttribute('aria-expanded', 'false');
    description.title = 'Show or hide the full description';
  });
}

export function DashboardDensityControl() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [density, setDensity] = useState<DensityMode>('operational');

  useEffect(() => {
    const remembered = window.localStorage.getItem(STORAGE_KEY);
    const initial = isDensityMode(remembered) ? remembered : 'operational';
    setDensity(initial);
    applyDensity(initial);

    const locate = () => {
      const actions = document.querySelector<HTMLElement>('.dashboard-workspace-experience .ric-topbar > div:last-child');
      if (actions) setTarget(actions);
      enhanceLongCopy();
    };

    const toggleCopy = (event: Event) => {
      const targetElement = event.target;
      if (!(targetElement instanceof Element)) return;
      const copy = targetElement.closest<HTMLElement>('.command-center-expandable-copy');
      if (!copy) return;
      const keyboardEvent = event instanceof KeyboardEvent ? event : null;
      if (keyboardEvent && keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
      keyboardEvent?.preventDefault();
      const expanded = copy.classList.toggle('expanded');
      copy.setAttribute('aria-expanded', String(expanded));
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', toggleCopy);
    document.addEventListener('keydown', toggleCopy);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', toggleCopy);
      document.removeEventListener('keydown', toggleCopy);
    };
  }, []);

  function selectDensity(next: DensityMode) {
    setDensity(next);
    applyDensity(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }

  if (!target) return null;

  return createPortal(
    <div className="dashboard-density-control" role="group" aria-label="Dashboard density">
      <span>Density</span>
      {DENSITY_OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={density === id ? 'active' : ''}
          aria-pressed={density === id}
          title={`${label} dashboard density`}
          onClick={() => selectDensity(id)}
        >
          <Icon size={14} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>,
    target
  );
}
