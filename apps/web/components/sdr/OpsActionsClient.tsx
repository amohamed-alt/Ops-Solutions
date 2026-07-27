'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardCheck, ListTodo, RefreshCw, ShieldCheck, UserRoundCog } from 'lucide-react';

import { ProductFlowNav } from './ProductFlowNav';
import './command-center-v2.css';

type WorkspaceRow = {
  workspace: { id: string; name: string; hubspot_status?: string | null };
};

type Capabilities = {
  connected: boolean;
  scopes: string[];
  requiredScopes: Record<string, string[]>;
  can: Record<string, boolean>;
};

const lifecycleStages = [
  ['subscriber', 'Subscriber'],
  ['lead', 'Lead'],
  ['marketingqualifiedlead', 'Marketing Qualified Lead'],
  ['salesqualifiedlead', 'Sales Qualified Lead'],
  ['opportunity', 'Opportunity'],
  ['customer', 'Customer'],
  ['evangelist', 'Evangelist'],
  ['other', 'Other']
];

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as T & { message?: string; details?: { missingScopes?: string[] } };
  if (!response.ok) {
    const missing = payload.details?.missingScopes?.length ? ` Missing scopes: ${payload.details.missingScopes.join(', ')}.` : '';
    throw new Error(`${payload.message || `Request failed with HTTP ${response.status}.`}${missing}`);
  }
  return payload;
}

function TextInput({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="cc2-company">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ActionCard({ title, description, icon: Icon, disabled, busy, onSubmit, children }: {
  title: string;
  description: string;
  icon: typeof ListTodo;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="cc2-panel ric-panel">
      <header>
        <div>
          <h2><Icon size={18} /> {title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="cc2-panel-body" style={{ display: 'grid', gap: 14 }}>
        {children}
        <button className="cc2-primary" type="button" disabled={disabled || busy} onClick={onSubmit}>
          {busy ? <RefreshCw className="cc2-spin" size={15} /> : <CheckCircle2 size={15} />}
          {busy ? 'Running…' : 'Run guarded action'}
        </button>
      </div>
    </section>
  );
}

export function OpsActionsClient() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [taskObjectType, setTaskObjectType] = useState('contacts');
  const [taskRecordId, setTaskRecordId] = useState('');
  const [taskSubject, setTaskSubject] = useState('Follow up from Ops Actions');
  const [taskBody, setTaskBody] = useState('');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskOwnerId, setTaskOwnerId] = useState('');

  const [contactId, setContactId] = useState('');
  const [lifecycleStage, setLifecycleStage] = useState('salesqualifiedlead');

  const [reviewObjectType, setReviewObjectType] = useState('contacts');
  const [reviewRecordId, setReviewRecordId] = useState('');
  const [reviewNote, setReviewNote] = useState('');

  const selectedWorkspace = useMemo(() => workspaces.find((row) => row.workspace.id === workspaceId), [workspaces, workspaceId]);

  async function loadWorkspaces() {
    const result = await json<{ results?: WorkspaceRow[] }>('/api/customer/workspaces');
    const connected = (result.results ?? []).filter((row) => row.workspace.hubspot_status === 'connected');
    setWorkspaces(connected);
    const nextWorkspaceId = workspaceId || connected[0]?.workspace.id || '';
    setWorkspaceId(nextWorkspaceId);
    if (nextWorkspaceId) await loadCapabilities(nextWorkspaceId);
  }

  async function loadCapabilities(id = workspaceId) {
    if (!id) return;
    const result = await json<Capabilities>(`/api/customer/workspaces/${encodeURIComponent(id)}/actions/capabilities`);
    setCapabilities(result);
  }

  useEffect(() => {
    void loadWorkspaces().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load Ops Actions.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runAction(name: string, handler: () => Promise<string>) {
    setBusy(name);
    setError('');
    setSuccess('');
    try {
      const message = await handler();
      setSuccess(message);
      if (workspaceId) await loadCapabilities(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to run this action.');
    } finally {
      setBusy('');
    }
  }

  const canCreateTask = Boolean(capabilities?.can?.createTask);
  const canUpdateLifecycle = Boolean(capabilities?.can?.updateLifecycleStage);

  return (
    <main className="cc2-shell" style={{ padding: 28 }}>
      <section className="cc2-hero ric-hero">
        <div>
          <span><ShieldCheck size={16} /> OPS ACTIONS</span>
          <h1>Guarded HubSpot write actions</h1>
          <p>Create tasks, update contact lifecycle stages, and mark records as reviewed with admin-only access and audit logging.</p>
        </div>
      </section>

      <ProductFlowNav
        current="actions"
        purpose="Use Ops Actions after the dashboard or builder surfaces a record that needs action. This page is for audited HubSpot writes and local review markers, not for building reports."
        nextSteps={[
          { label: 'Build reports first', href: '/builder', description: 'Create the report or dashboard that identifies which records need action.', badge: 'Before acting' },
          { label: 'Open command dashboard', href: '/dashboard', description: 'Review the live reporting context before changing CRM data.', badge: 'Validate' },
          { label: 'Review billing package', href: '/settings/billing', description: 'Decide whether guarded actions belong in the Automation plan.', badge: 'Package' }
        ]}
      />

      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2>Workspace and permissions</h2>
            <p>Write actions require the workspace to be reconnected with the optional HubSpot write scopes.</p>
          </div>
          <button type="button" onClick={() => void loadCapabilities()}><RefreshCw size={15} />Refresh permissions</button>
        </header>
        <div className="cc2-panel-body" style={{ display: 'grid', gap: 12 }}>
          <label className="cc2-company">
            <span>Workspace</span>
            <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); void loadCapabilities(event.target.value); }}>
              {workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}
            </select>
          </label>
          <div className="cc2-empty">
            {selectedWorkspace ? `Selected: ${selectedWorkspace.workspace.name}` : 'No connected workspace found.'}<br />
            Task write: {canCreateTask ? 'Ready' : 'Needs reconnect'} · Lifecycle write: {canUpdateLifecycle ? 'Ready' : 'Needs reconnect'} · Mark reviewed: Ready
          </div>
        </div>
      </section>

      {error ? <div className="dashboard-rollout-recovery" role="alert"><strong>Action failed.</strong><p>{error}</p></div> : null}
      {success ? <div className="dashboard-rollout-recovery saved-view-delete-guard" role="status"><strong>Done.</strong><p>{success}</p></div> : null}

      <div className="cc2-grid two">
        <ActionCard
          title="Create HubSpot task"
          description="Creates a CRM task and attempts to associate it with the selected contact, company, or deal."
          icon={ListTodo}
          disabled={!workspaceId || !canCreateTask}
          busy={busy === 'task'}
          onSubmit={() => void runAction('task', async () => {
            const result = await json<{ status: string; taskId?: string | null; associationWarning?: string | null }>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/actions/tasks`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                objectType: taskObjectType,
                recordId: taskRecordId,
                subject: taskSubject,
                body: taskBody,
                dueAt: taskDueAt,
                ownerId: taskOwnerId
              })
            });
            return result.associationWarning
              ? `Task ${result.taskId || ''} created, but association needs review: ${result.associationWarning}`
              : `Task ${result.taskId || ''} created.`;
          })}
        >
          <label className="cc2-company"><span>Target object</span><select value={taskObjectType} onChange={(event) => setTaskObjectType(event.target.value)}><option value="contacts">Contact</option><option value="companies">Company</option><option value="deals">Deal</option></select></label>
          <TextInput label="Target record ID" value={taskRecordId} onChange={setTaskRecordId} placeholder="HubSpot record ID" />
          <TextInput label="Subject" value={taskSubject} onChange={setTaskSubject} />
          <TextInput label="Body / notes" value={taskBody} onChange={setTaskBody} placeholder="Optional" />
          <TextInput label="Due date/time" value={taskDueAt} onChange={setTaskDueAt} type="datetime-local" />
          <TextInput label="HubSpot owner ID" value={taskOwnerId} onChange={setTaskOwnerId} placeholder="Optional" />
        </ActionCard>

        <ActionCard
          title="Update lifecycle stage"
          description="Updates the HubSpot contact lifecyclestage property only after admin validation."
          icon={UserRoundCog}
          disabled={!workspaceId || !canUpdateLifecycle}
          busy={busy === 'lifecycle'}
          onSubmit={() => void runAction('lifecycle', async () => {
            const result = await json<{ lifecycleStage: string }>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/actions/contacts/${encodeURIComponent(contactId)}/lifecycle-stage`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ lifecycleStage })
            });
            return `Contact ${contactId} moved to ${result.lifecycleStage}.`;
          })}
        >
          <TextInput label="Contact ID" value={contactId} onChange={setContactId} placeholder="HubSpot contact ID" />
          <label className="cc2-company"><span>Lifecycle stage</span><select value={lifecycleStage} onChange={(event) => setLifecycleStage(event.target.value)}>{lifecycleStages.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </ActionCard>

        <ActionCard
          title="Mark record as reviewed"
          description="Stores an Ops review marker locally with user, timestamp, workspace, object type, and audit log."
          icon={ClipboardCheck}
          disabled={!workspaceId}
          busy={busy === 'reviewed'}
          onSubmit={() => void runAction('reviewed', async () => {
            const result = await json<{ objectType: string; recordId: string }>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/actions/records/reviewed`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ objectType: reviewObjectType, recordId: reviewRecordId, note: reviewNote })
            });
            return `${result.objectType} ${result.recordId} marked as reviewed.`;
          })}
        >
          <label className="cc2-company"><span>Object type</span><select value={reviewObjectType} onChange={(event) => setReviewObjectType(event.target.value)}><option value="contacts">Contact</option><option value="companies">Company</option><option value="deals">Deal</option><option value="tasks">Task</option><option value="calls">Call</option><option value="meetings">Meeting</option></select></label>
          <TextInput label="Record ID" value={reviewRecordId} onChange={setReviewRecordId} placeholder="HubSpot record ID" />
          <TextInput label="Review note" value={reviewNote} onChange={setReviewNote} placeholder="Optional" />
        </ActionCard>
      </div>
    </main>
  );
}
