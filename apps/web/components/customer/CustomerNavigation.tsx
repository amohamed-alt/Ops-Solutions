'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { BarChart3, Building2, FileSpreadsheet, LogOut, Settings, ShieldCheck, Waypoints } from 'lucide-react';
import { useEffect, useState } from 'react';

import styles from './CustomerNavigation.module.css';

type Session = {
  authenticated?: boolean;
  user?: { displayName?: string; email?: string };
};

const CUSTOMER_ROUTES = ['/dashboard', '/exports', '/settings'];

export function CustomerNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const visible = CUSTOMER_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));

  useEffect(() => {
    if (!visible) return;
    let active = true;
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : { authenticated: false })
      .then((payload) => { if (active) setSession(payload); })
      .catch(() => { if (active) setSession({ authenticated: false }); });
    return () => { active = false; };
  }, [visible, pathname]);

  if (!visible || !session?.authenticated) return null;

  async function logout() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch('/api/customer/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/onboarding');
      router.refresh();
    }
  }

  return (
    <nav className={styles.nav} aria-label="Customer workspace navigation">
      <div className={styles.identity}>
        <span><ShieldCheck size={16} /></span>
        <div>
          <strong>{session.user?.displayName || 'Workspace member'}</strong>
          <small>{session.user?.email || 'Secure customer session'}</small>
        </div>
      </div>
      <div className={styles.links}>
        <Link href="/dashboard" className={pathname.startsWith('/dashboard') ? styles.active : ''}>
          <BarChart3 size={16} /> Dashboard
        </Link>
        <Link href="/exports" className={pathname.startsWith('/exports') ? styles.active : ''}>
          <FileSpreadsheet size={16} /> Exports
        </Link>
        <Link href="/settings/workspace" className={pathname.startsWith('/settings/workspace') ? styles.active : ''}>
          <Building2 size={16} /> Workspace
        </Link>
        <Link href="/settings/mappings" className={pathname.startsWith('/settings/mappings') ? styles.active : ''}>
          <Waypoints size={16} /> Mappings
        </Link>
        <Link href="/settings/team" className={pathname.startsWith('/settings/team') ? styles.active : ''}>
          <Settings size={16} /> Team & security
        </Link>
        <button type="button" onClick={logout} disabled={signingOut}>
          <LogOut size={16} /> {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </nav>
  );
}
