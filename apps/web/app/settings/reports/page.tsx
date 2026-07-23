'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, FileSpreadsheet, LoaderCircle, Mail, Pause, Play, Plus, Trash2 } from 'lucide-react';

import styles from './reports.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type SavedView = { id: string; name: string; isDefault?: boolean };
type Schedule = {
  id: string; name: string; savedViewId: string; savedViewName?: string; frequency: 'daily' | 'weekly' | 'monthly';
  weekday?: number | null; monthday?: number | null; deliveryHour: number; deliveryMinute: number; timezone: string;
  recipients: string[]; format: 'csv' | 'xlsx'; deliveryMode: 'summary' | 'attachment'; enabled: boolean;
  nextRunAt: string; lastRunAt?: string | null; lastSuccessAt?: string | null; lastFailureAt?: string | null; lastError?: string | null;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['Africa/Cairo', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'UTC'];
const roleRank = { viewer: 1, admin: 2, owner: 3 };

function when(value?: string | null) {
  if (!value) return 'Not run yet';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function cadence(schedule: Schedule) {
  const time = `${String(schedule.deliveryHour).padStart(2, '0')}:${String(schedule.deliveryMinute).padStart(2, '0')}`;
  if (schedule.frequency === 'daily') return `Daily at ${time}`;
  if (schedule.frequency === 'weekly') return `${DAYS[schedule.weekday ?? 1]} at ${time}`;
  return `Day ${schedule.monthday ?? 1} at ${time}`;
}

export default function ScheduledReportsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [views, setViews] = useState<SavedView[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    name: 'Weekly leadership report', savedViewId: '', frequency: 'weekly', weekday: '1', monthday: '1',
    deliveryHour: '8', deliveryMinute: '0', timezone: 'Africa/Cairo', recipients: '', format: 'xlsx', deliveryMode: 'attachment'
  });

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canManage = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);

  async function loadWorkspaceData(id: string) {
    if (!id) return;
    setLoading(true);
    setMessage('');
    try {
      const [viewsResponse, schedulesResponse] = await Promise.all([
        fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/saved-views`, { cache: 'no-store' }),
        fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/report-schedules`, { cache: 'no-store' })
      ]);
      const viewPayload = await viewsResponse.json();
      const schedulePayload = await schedulesResponse.json();
      if (!viewsResponse.ok) throw new Error(viewPayload.message || 'Unable to load saved views.');
      if (!schedulesResponse.ok) throw new Error(schedulePayload.message || 'Unable to load report schedules.');
      const nextViews = viewPayload.results ?? [];
      setViews(nextViews);
      setSchedules(schedulePayload.results ?? []);
      setForm((current) => ({ ...current, savedViewId: current.savedViewId || nextViews.find((item: SavedView) => item.isDefault)?.id || nextViews[0]?.id || '' }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load scheduled reports.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Sign in to continue.');
        const rows = (payload.workspaces ?? []) as Workspace[];
        setWorkspaces(rows);
        setWorkspaceId(rows[0]?.id ?? '');
      })
      .catch((error) => { setMessage(error.message); setLoading(false); });
  }, []);

  useEffect(() => { if (workspaceId) void loadWorkspaceData(workspaceId); }, [workspaceId]);

  async function createSchedule() {
    if (!workspaceId || busy) return;
    setBusy('create'); setMessage(''); setSuccess('');
    try {
      const recipients = form.recipients.split(/[;,\n]/).map((value) => value.trim()).filter(Boolean);
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          weekday: Number(form.weekday), monthday: Number(form.monthday),
          deliveryHour: Number(form.deliveryHour), deliveryMinute: Number(form.deliveryMinute), recipients
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to create report schedule.');
      setSuccess('Scheduled report created. Export generation will run automatically at the configured local time.');
      setForm((current) => ({ ...current, recipients: '' }));
      await loadWorkspaceData(workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create report schedule.');
    } finally { setBusy(''); }
  }

  async function toggle(schedule: Schedule) {
    setBusy(schedule.id); setMessage(''); setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules/${encodeURIComponent(schedule.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: schedule.name, savedViewId: schedule.savedViewId, frequency: schedule.frequency,
          weekday: schedule.weekday, monthday: schedule.monthday, deliveryHour: schedule.deliveryHour,
          deliveryMinute: schedule.deliveryMinute, timezone: schedule.timezone, recipients: schedule.recipients,
          format: schedule.format, deliveryMode: schedule.deliveryMode, enabled: !schedule.enabled
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || 'Unable to update report schedule.');
      setSuccess(schedule.enabled ? 'Schedule paused.' : 'Schedule resumed.');
      await loadWorkspaceData(workspaceId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update report schedule.'); }
    finally { setBusy(''); }
  }

  async function remove(schedule: Schedule) {
    if (!window.confirm(`Delete “${schedule.name}”?`)) return;
    setBusy(schedule.id); setMessage(''); setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Unable to delete report schedule.');
      }
      setSuccess('Schedule deleted.');
      await loadWorkspaceData(workspaceId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete report schedule.'); }
    finally { setBusy(''); }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div><span>SCHEDULED REPORTING</span><h1>Deliver revenue intelligence on time.</h1><p>Turn saved dashboard views into recurring CSV or XLSX report jobs with tenant-safe scheduling, execution history, retries and duplicate protection.</p></div>
        <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </header>

      {message ? <div className={styles.error}><AlertTriangle size={17} />{message}</div> : null}
      {success ? <div className={styles.success}><CheckCircle2 size={17} />{success}</div> : null}

      <section className={styles.notice}><Mail /><div><strong>Delivery provider pending</strong><p>Schedules and exports run now. Email dispatch remains safely queued until an SMTP, Postmark or Resend account is selected and configured.</p></div></section>

      <div className={styles.grid}>
        <section className={styles.builder}>
          <header><Plus /><div><h2>Create schedule</h2><p>Use a saved view so reporting definitions remain consistent.</p></div></header>
          {!canManage ? <p className={styles.readonly}>Viewer access can monitor schedules. Admin or owner access is required to create or change them.</p> : null}
          <div className={styles.form}>
            <label><span>Schedule name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label><span>Saved view</span><select value={form.savedViewId} onChange={(event) => setForm({ ...form, savedViewId: event.target.value })}><option value="">Choose a saved view</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
            <label><span>Frequency</span><select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
            {form.frequency === 'weekly' ? <label><span>Weekday</span><select value={form.weekday} onChange={(event) => setForm({ ...form, weekday: event.target.value })}>{DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label> : null}
            {form.frequency === 'monthly' ? <label><span>Month day</span><input type="number" min="1" max="28" value={form.monthday} onChange={(event) => setForm({ ...form, monthday: event.target.value })} /></label> : null}
            <div className={styles.inline}><label><span>Hour</span><input type="number" min="0" max="23" value={form.deliveryHour} onChange={(event) => setForm({ ...form, deliveryHour: event.target.value })} /></label><label><span>Minute</span><input type="number" min="0" max="59" value={form.deliveryMinute} onChange={(event) => setForm({ ...form, deliveryMinute: event.target.value })} /></label></div>
            <label><span>Timezone</span><select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}>{ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
            <label><span>Recipients</span><textarea value={form.recipients} onChange={(event) => setForm({ ...form, recipients: event.target.value })} placeholder="ceo@example.com, ops@example.com" /></label>
            <div className={styles.inline}><label><span>Format</span><select value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value })}><option value="xlsx">XLSX</option><option value="csv">CSV</option></select></label><label><span>Delivery</span><select value={form.deliveryMode} onChange={(event) => setForm({ ...form, deliveryMode: event.target.value })}><option value="attachment">Attachment</option><option value="summary">Summary only</option></select></label></div>
            <button onClick={createSchedule} disabled={!canManage || !form.savedViewId || !form.recipients || Boolean(busy)}>{busy === 'create' ? <LoaderCircle className={styles.spin} /> : <CalendarClock />}Create schedule</button>
          </div>
        </section>

        <section className={styles.list}>
          <header><Clock3 /><div><h2>Active schedules</h2><p>{schedules.length} configured for {workspace?.name || 'this company'}.</p></div></header>
          {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} />Loading schedules…</div> : null}
          {!loading && schedules.length === 0 ? <div className={styles.empty}><FileSpreadsheet /><strong>No schedules yet</strong><span>Create one from a saved dashboard view.</span></div> : null}
          {schedules.map((schedule) => <article key={schedule.id} className={!schedule.enabled ? styles.paused : ''}>
            <div className={styles.scheduleTop}><div><span className={styles.status}>{schedule.enabled ? 'Active' : 'Paused'}</span><h3>{schedule.name}</h3><p>{schedule.savedViewName || 'Saved view'} · {schedule.format.toUpperCase()}</p></div><div className={styles.actions}><button onClick={() => void toggle(schedule)} disabled={!canManage || Boolean(busy)}>{schedule.enabled ? <Pause /> : <Play />}</button><button onClick={() => void remove(schedule)} disabled={!canManage || Boolean(busy)}><Trash2 /></button></div></div>
            <dl><div><dt>Cadence</dt><dd>{cadence(schedule)}</dd></div><div><dt>Timezone</dt><dd>{schedule.timezone}</dd></div><div><dt>Next run</dt><dd>{when(schedule.nextRunAt)}</dd></div><div><dt>Last success</dt><dd>{when(schedule.lastSuccessAt)}</dd></div><div><dt>Recipients</dt><dd>{schedule.recipients.length}</dd></div><div><dt>Delivery</dt><dd>{schedule.deliveryMode}</dd></div></dl>
            {schedule.lastError ? <p className={styles.scheduleError}>{schedule.lastError}</p> : null}
          </article>)}
        </section>
      </div>
    </main>
  );
}
