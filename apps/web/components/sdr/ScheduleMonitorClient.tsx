'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronUp, MailCheck, Pause, Play, RefreshCw } from 'lucide-react';

import { executionStatusLabel, scheduleHealth, scheduleUpdatePayload } from './schedule-monitor.mjs';
import './command-center-v2.css';

type WorkspaceRow = {
  workspace: { id: string; name: string; hubspot_status?: string | null };
};

type Schedule = {
  id: string;
  savedViewId: string;
  savedViewName?: string | null;
  name: string;
  frequency: string;
  weekday?: number | null;
  monthday?: number | null;
  deliveryHour: number;
  deliveryMinute: number;
  timezone: string;
  recipients: string[];
  format: string;
  deliveryMode: string;
  enabled: boolean;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastError?: string | null;
};

type Execution = {
  id: string;
  scheduled_for?: string | null;
  status?: string | null;
  delivery_status?: string | null;
  error?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  export_status?: string | null;
  file_name?: string | null;
};

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

export function ScheduleMonitorClient() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [expandedId, setExpandedId] = useState('');
  const [executions, setExecutions] = useState<Record<string, Execution[]>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedWorkspace = useMemo(
    () => workspaces.find((row) => row.workspace.id === workspaceId),
    [workspaces, workspaceId]
  );

  async function loadSchedules(id: string) {
    if (!id) return;
    const result = await json<{ results?: Schedule[] }>(
      `/api/customer/workspaces/${encodeURIComponent(id)}/report-schedules`
    );
    setSchedules(result.results ?? []);
  }

  async function load() {
    setError('');
    const result = await json<{ results?: WorkspaceRow[] }>('/api/customer/workspaces');
    const connected = (result.results ?? []).filter((row) => row.workspace.hubspot_status === 'connected');
    setWorkspaces(connected);
    const nextWorkspaceId = workspaceId || connected[0]?.workspace.id || '';
    setWorkspaceId(nextWorkspaceId);
    if (nextWorkspaceId) await loadSchedules(nextWorkspaceId);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load schedule monitor.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleSchedule(schedule: Schedule) {
    setBusy(schedule.id);
    setError('');
    setSuccess('');
    try {
      const nextEnabled = !schedule.enabled;
      await json<Schedule>(
        `/api/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules/${encodeURIComponent(schedule.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(scheduleUpdatePayload(schedule, nextEnabled))
        }
      );
      await loadSchedules(workspaceId);
      setSuccess(`${schedule.name} ${nextEnabled ? 'resumed' : 'paused'}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update schedule.');
    } finally {
      setBusy('');
    }
  }

  async function toggleExecutions(scheduleId: string) {
    if (expandedId === scheduleId) {
      setExpandedId('');
      return;
    }
    setExpandedId(scheduleId);
    if (executions[scheduleId]) return;
    setBusy(`executions:${scheduleId}`);
    setError('');
    try {
      const result = await json<{ results?: Execution[] }>(
        `/api/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules/${encodeURIComponent(scheduleId)}/executions`
      );
      setExecutions((current) => ({ ...current, [scheduleId]: result.results ?? [] }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load execution history.');
    } finally {
      setBusy('');
    }
  }

  return (
    <main className="cc2-shell" style={{ padding: '0 28px 28px' }}>
      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2><MailCheck size={18} /> Scheduled email delivery monitor</h2>
            <p>See whether recurring reports are healthy, delayed, paused, or failing, and inspect each execution.</p>
          </div>
          <button type="button" onClick={() => void load()}><RefreshCw size={15} />Refresh</button>
        </header>
        <div className="cc2-panel-body" style={{ display: 'grid', gap: 14 }}>
          <label className="cc2-company">
            <span>Workspace</span>
            <select
              value={workspaceId}
              onChange={(event) => {
                const id = event.target.value;
                setWorkspaceId(id);
                setExpandedId('');
                void loadSchedules(id).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load schedules.'));
              }}
            >
              {workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}
            </select>
          </label>
          <div className="cc2-empty">
            {selectedWorkspace ? `Monitoring: ${selectedWorkspace.workspace.name}` : 'No connected workspace found.'}<br />
            Schedules: {schedules.length} · Enabled: {schedules.filter((schedule) => schedule.enabled).length} · Paused: {schedules.filter((schedule) => !schedule.enabled).length}
          </div>
        </div>
      </section>

      {error ? <div className="dashboard-rollout-recovery" role="alert"><strong>Schedule monitor failed.</strong><p>{error}</p></div> : null}
      {success ? <div className="dashboard-rollout-recovery saved-view-delete-guard" role="status"><strong>Done.</strong><p>{success}</p></div> : null}

      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2><CalendarClock size={18} /> Delivery status</h2>
            <p>Health is derived from the latest success, failure, next run, and enabled state recorded by the scheduler.</p>
          </div>
        </header>
        <div className="cc2-panel-body" style={{ display: 'grid', gap: 12 }}>
          {schedules.length === 0 ? <div className="cc2-empty">No email schedules configured for this workspace.</div> : schedules.map((schedule) => {
            const health = scheduleHealth(schedule);
            const isExpanded = expandedId === schedule.id;
            const history = executions[schedule.id] ?? [];
            return (
              <article key={schedule.id} className="cc2-company-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <strong>{schedule.name}</strong>
                    <span>{schedule.savedViewName || 'Saved view'} · {schedule.frequency} · {schedule.timezone}</span>
                    <p>{health.detail}</p>
                  </div>
                  <span>{health.state === 'healthy' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />} {health.label}</span>
                </div>
                <div className="cc2-grid two" style={{ marginTop: 10 }}>
                  <div className="cc2-empty" style={{ textAlign: 'left' }}>Next run<br /><strong>{formatDate(schedule.nextRunAt)}</strong></div>
                  <div className="cc2-empty" style={{ textAlign: 'left' }}>Last success<br /><strong>{formatDate(schedule.lastSuccessAt)}</strong></div>
                  <div className="cc2-empty" style={{ textAlign: 'left' }}>Last failure<br /><strong>{formatDate(schedule.lastFailureAt)}</strong></div>
                  <div className="cc2-empty" style={{ textAlign: 'left' }}>Recipients<br /><strong>{schedule.recipients.length}</strong></div>
                </div>
                {schedule.lastError ? <div className="dashboard-rollout-recovery" role="status"><strong>Latest error</strong><p>{schedule.lastError}</p></div> : null}
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                  <button type="button" disabled={busy === schedule.id} onClick={() => void toggleSchedule(schedule)}>
                    {busy === schedule.id ? <RefreshCw className="cc2-spin" size={15} /> : schedule.enabled ? <Pause size={15} /> : <Play size={15} />}
                    {schedule.enabled ? 'Pause schedule' : 'Resume schedule'}
                  </button>
                  <button type="button" disabled={busy === `executions:${schedule.id}`} onClick={() => void toggleExecutions(schedule.id)}>
                    {busy === `executions:${schedule.id}` ? <RefreshCw className="cc2-spin" size={15} /> : isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {isExpanded ? 'Hide executions' : 'View executions'}
                  </button>
                </div>
                {isExpanded ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {history.length === 0 ? <div className="cc2-empty">No executions recorded yet.</div> : history.map((execution) => (
                      <div key={execution.id} className="cc2-empty" style={{ textAlign: 'left' }}>
                        <strong>{executionStatusLabel(execution)}</strong> · Scheduled {formatDate(execution.scheduled_for)}
                        <br />Export: {execution.export_status || 'Not available'} · Completed: {formatDate(execution.completed_at)}
                        {execution.error ? <><br />Error: {execution.error}</> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
