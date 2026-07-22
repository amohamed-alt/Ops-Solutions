'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Copy, Crown, History, LoaderCircle, MailPlus, ShieldCheck, Trash2, UserCog, UsersRound } from 'lucide-react';

import styles from './team.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type Member = { id: string; email: string; displayName: string; role: Workspace['role']; status: string; createdAt: string };
type Invitation = { id: string; email: string; role: 'admin' | 'viewer'; status: string; expires_at: string; created_at: string };
type AuditEvent = { id: string; action: string; target_type?: string; target_id?: string; actor_name?: string; actor_email?: string; metadata?: Record<string, unknown>; created_at: string };

const roleRank = { viewer: 1, admin: 2, owner: 3 };

function label(value: string) {
  return value.replaceAll('.', ' · ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function TeamSettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'viewer'>('viewer');
  const [inviteLink, setInviteLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId), [workspaces, workspaceId]);
  const canAdmin = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);
  const canOwn = workspace?.role === 'owner';

  const load = useCallback(async (id: string, appendAudit = false, before?: string | null) => {
    setBusy(true);
    setMessage('');
    try {
      const [teamResponse, auditResponse] = await Promise.all([
        fetch(`/api/customer/workspaces/${id}/team`, { cache: 'no-store' }),
        fetch(`/api/customer/workspaces/${id}/audit${before ? `?before=${encodeURIComponent(before)}` : ''}`, { cache: 'no-store' })
      ]);
      const team = await teamResponse.json();
      const audit = await auditResponse.json();
      if (!teamResponse.ok) throw new Error(team.message || 'Unable to load team settings.');
      setMembers(team.members ?? []);
      setInvitations(team.invitations ?? []);
      if (auditResponse.ok) {
        setEvents((current) => appendAudit ? [...current, ...(audit.results ?? [])] : (audit.results ?? []));
        setNextCursor(audit.nextCursor ?? null);
      } else if (auditResponse.status !== 403) {
        throw new Error(audit.message || 'Unable to load audit history.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load settings.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to manage your workspace.');
        const payload = await response.json();
        const rows = payload.workspaces ?? [];
        setWorkspaces(rows);
        setWorkspaceId(rows[0]?.id ?? '');
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId, load]);

  async function invite() {
    if (!workspaceId || !email) return;
    setBusy(true); setMessage(''); setInviteLink('');
    const response = await fetch(`/api/customer/workspaces/${workspaceId}/team`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, role: inviteRole })
    });
    const payload = await response.json();
    if (!response.ok) { setMessage(payload.message || 'Unable to create invitation.'); setBusy(false); return; }
    setInviteLink(`${window.location.origin}${payload.acceptPath}`);
    setEmail('');
    await load(workspaceId);
  }

  async function changeRole(userId: string, role: Workspace['role']) {
    setBusy(true); setMessage('');
    const response = await fetch(`/api/customer/workspaces/${workspaceId}/team`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId, role })
    });
    const payload = response.status === 204 ? {} : await response.json();
    if (!response.ok) setMessage(payload.message || 'Unable to update role.');
    await load(workspaceId);
  }

  async function remove(kind: 'member' | 'invitation', id: string) {
    setBusy(true); setMessage('');
    const response = await fetch(`/api/customer/workspaces/${workspaceId}/team`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(kind === 'member' ? { kind, userId: id } : { kind, invitationId: id })
    });
    const payload = response.status === 204 ? {} : await response.json();
    if (!response.ok) setMessage(payload.message || 'Unable to remove access.');
    await load(workspaceId);
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div><span>WORKSPACE SECURITY</span><h1>Team & access control</h1><p>Manage people, permissions, invitations and the complete security trail.</p></div>
        <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </header>

      {message ? <div className={styles.error}>{message}</div> : null}
      <section className={styles.stats}>
        <article><UsersRound /><div><strong>{members.length}</strong><span>Active members</span></div></article>
        <article><MailPlus /><div><strong>{invitations.filter((item) => item.status === 'pending').length}</strong><span>Pending invites</span></div></article>
        <article><ShieldCheck /><div><strong>{workspace?.role ?? '—'}</strong><span>Your access level</span></div></article>
        <article><History /><div><strong>{events.length}</strong><span>Recent audit events</span></div></article>
      </section>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Workspace members</h2><p>Owner, admin and read-only viewer access.</p></div><UserCog /></div>
          <div className={styles.memberList}>{members.map((member) => (
            <article key={member.id}>
              <span className={styles.avatar}>{member.displayName?.slice(0, 1).toUpperCase() || member.email.slice(0, 1).toUpperCase()}</span>
              <div className={styles.person}><strong>{member.displayName || member.email}</strong><small>{member.email}</small></div>
              <span className={`${styles.role} ${styles[member.role]}`}>{member.role === 'owner' ? <Crown size={13} /> : null}{member.role}</span>
              {canOwn ? <select value={member.role} onChange={(event) => void changeRole(member.id, event.target.value as Workspace['role'])}><option value="owner">Owner</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select> : null}
              {canOwn ? <button className={styles.danger} onClick={() => void remove('member', member.id)} aria-label="Remove member"><Trash2 size={15} /></button> : null}
            </article>
          ))}</div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelTitle}><div><h2>Invite your team</h2><p>Links expire automatically after seven days.</p></div><MailPlus /></div>
          {canAdmin ? <div className={styles.inviteForm}><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="colleague@company.com" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'admin' | 'viewer')}><option value="viewer">Viewer</option><option value="admin">Admin</option></select><button onClick={() => void invite()} disabled={busy || !email}>{busy ? <LoaderCircle className={styles.spin} /> : <MailPlus />}Create invite</button></div> : <p className={styles.locked}>Admin access is required to invite people.</p>}
          {inviteLink ? <div className={styles.linkBox}><code>{inviteLink}</code><button onClick={() => navigator.clipboard.writeText(inviteLink)}><Copy size={15} />Copy</button></div> : null}
          <div className={styles.invites}>{invitations.map((item) => <article key={item.id}><div><strong>{item.email}</strong><small>{item.role} · expires {when(item.expires_at)}</small></div><span>{item.status}</span>{canAdmin && item.status === 'pending' ? <button onClick={() => void remove('invitation', item.id)}><Trash2 size={14} /></button> : null}</article>)}</div>
        </section>
      </div>

      {canAdmin ? <section className={`${styles.panel} ${styles.audit}`}>
        <div className={styles.panelTitle}><div><h2>Security audit trail</h2><p>Immutable workspace events with actor and target context.</p></div><Activity /></div>
        <div className={styles.timeline}>{events.map((event) => <article key={event.id}><span /><div><strong>{label(event.action)}</strong><small>{event.actor_name || event.actor_email || 'System'} · {when(event.created_at)}</small><p>{event.target_type ? `${label(event.target_type)}: ${event.target_id || '—'}` : 'Workspace event'}</p></div></article>)}</div>
        {nextCursor ? <button className={styles.more} onClick={() => void load(workspaceId, true, nextCursor)} disabled={busy}>Load older events</button> : null}
      </section> : null}
    </main>
  );
}
