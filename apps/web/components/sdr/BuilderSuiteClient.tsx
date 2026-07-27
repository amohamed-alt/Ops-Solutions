'use client';

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarClock, CheckCircle2, LayoutDashboard, Mail, PlusCircle, RefreshCw, Settings2 } from 'lucide-react';

import { ProductFlowNav } from './ProductFlowNav';
import './command-center-v2.css';

type WorkspaceRow = {
  workspace: { id: string; name: string; hubspot_status?: string | null };
};

type SavedView = {
  id: string;
  name: string;
  section: string;
  datePreset: string;
  widgetConfiguration?: Record<string, any> | null;
};

type Schedule = {
  id: string;
  name: string;
  savedViewName?: string | null;
  frequency: string;
  timezone: string;
  nextRunAt: string;
  enabled: boolean;
};

const objectTypes = ['contacts', 'companies', 'deals', 'activities'];
const metrics = ['count', 'sum_amount', 'average_amount', 'conversion_rate'];
const groupByOptions = ['none', 'owner', 'country', 'lead_status', 'lifecycle_stage', 'industry', 'source', 'pipeline', 'stage', 'created_month'];
const chartTypes = ['kpi', 'table', 'bar', 'line', 'pie'];
const datePresets = ['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'previous_month', 'this_quarter', 'this_year'];

async function json<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init });
  const payload = await response.json().catch(() => ({})) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `Request failed with HTTP ${response.status}.`);
  return payload;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="cc2-company"><span>{label}</span>{children}</label>;
}

function TextInput({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  return <Field label={label}><input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option.replaceAll('_', ' ')}</option>)}
      </select>
    </Field>
  );
}

function Panel({ title, description, icon: Icon, children }: { title: string; description: string; icon: typeof BarChart3; children: React.ReactNode }) {
  return (
    <section className="cc2-panel ric-panel">
      <header>
        <div>
          <h2><Icon size={18} /> {title}</h2>
          <p>{description}</p>
        </div>
      </header>
      <div className="cc2-panel-body" style={{ display: 'grid', gap: 14 }}>{children}</div>
    </section>
  );
}

function splitEmails(value: string) {
  return [...new Set(value.split(/[\n,;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export function BuilderSuiteClient() {
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [reportName, setReportName] = useState('Contacts by lifecycle stage');
  const [reportObjectType, setReportObjectType] = useState('contacts');
  const [reportMetric, setReportMetric] = useState('count');
  const [reportGroupBy, setReportGroupBy] = useState('lifecycle_stage');
  const [reportChartType, setReportChartType] = useState('bar');
  const [reportDatePreset, setReportDatePreset] = useState('last_30_days');

  const [dashboardName, setDashboardName] = useState('Executive overview dashboard');
  const [dashboardDescription, setDashboardDescription] = useState('Leadership view built from saved builder reports.');
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([]);

  const [scheduleName, setScheduleName] = useState('Weekly executive report');
  const [scheduleViewId, setScheduleViewId] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState('weekly');
  const [scheduleTimezone, setScheduleTimezone] = useState('Asia/Riyadh');
  const [scheduleRecipients, setScheduleRecipients] = useState('');
  const [scheduleHour, setScheduleHour] = useState('8');
  const [scheduleMinute, setScheduleMinute] = useState('0');
  const [scheduleWeekday, setScheduleWeekday] = useState('1');
  const [scheduleMonthday, setScheduleMonthday] = useState('1');

  const selectedWorkspace = useMemo(() => workspaces.find((row) => row.workspace.id === workspaceId), [workspaces, workspaceId]);
  const builderReports = useMemo(() => savedViews.filter((view) => view.widgetConfiguration?.builderType === 'report'), [savedViews]);
  const builderDashboards = useMemo(() => savedViews.filter((view) => view.widgetConfiguration?.builderType === 'dashboard'), [savedViews]);

  async function loadWorkspaceData(id: string) {
    if (!id) return;
    const [views, scheduleResult] = await Promise.all([
      json<{ results?: SavedView[] }>(`/api/customer/workspaces/${encodeURIComponent(id)}/saved-views`),
      json<{ results?: Schedule[] }>(`/api/customer/workspaces/${encodeURIComponent(id)}/report-schedules`).catch(() => ({ results: [] }))
    ]);
    const nextViews = views.results ?? [];
    setSavedViews(nextViews);
    setSchedules(scheduleResult.results ?? []);
    setScheduleViewId((current) => current || nextViews[0]?.id || '');
  }

  async function load() {
    setError('');
    const result = await json<{ results?: WorkspaceRow[] }>('/api/customer/workspaces');
    const connected = (result.results ?? []).filter((row) => row.workspace.hubspot_status === 'connected');
    setWorkspaces(connected);
    const nextWorkspaceId = workspaceId || connected[0]?.workspace.id || '';
    setWorkspaceId(nextWorkspaceId);
    if (nextWorkspaceId) await loadWorkspaceData(nextWorkspaceId);
  }

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load builder.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(name: string, handler: () => Promise<string>) {
    setBusy(name);
    setError('');
    setSuccess('');
    try {
      const message = await handler();
      setSuccess(message);
      if (workspaceId) await loadWorkspaceData(workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to complete builder action.');
    } finally {
      setBusy('');
    }
  }

  async function createReport() {
    return run('report', async () => {
      const created = await json<SavedView>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: reportName,
          datePreset: reportDatePreset,
          section: 'overview',
          filters: {},
          widgetConfiguration: {
            builderType: 'report',
            objectType: reportObjectType,
            metric: reportMetric,
            groupBy: reportGroupBy,
            chartType: reportChartType,
            version: 1
          }
        })
      });
      return `Report builder view created: ${created.name}.`;
    });
  }

  async function createDashboard() {
    return run('dashboard', async () => {
      const selectedReports = builderReports.filter((report) => selectedReportIds.includes(report.id));
      const layout = selectedReports.map((report, index) => ({
        id: `widget-${index + 1}`,
        savedViewId: report.id,
        title: report.name,
        width: index === 0 ? 'full' : 'half'
      }));
      const created = await json<SavedView>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/saved-views`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: dashboardName,
          datePreset: 'last_30_days',
          section: 'overview',
          filters: {},
          widgetConfiguration: {
            builderType: 'dashboard',
            description: dashboardDescription,
            layout,
            version: 1
          }
        })
      });
      return `Dashboard builder view created: ${created.name}.`;
    });
  }

  async function createSchedule() {
    return run('schedule', async () => {
      const recipients = splitEmails(scheduleRecipients);
      const created = await json<Schedule>(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/report-schedules`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: scheduleName,
          savedViewId: scheduleViewId,
          frequency: scheduleFrequency,
          timezone: scheduleTimezone,
          recipients,
          format: 'xlsx',
          deliveryMode: 'attachment',
          deliveryHour: Number(scheduleHour),
          deliveryMinute: Number(scheduleMinute),
          weekday: Number(scheduleWeekday),
          monthday: Number(scheduleMonthday),
          enabled: true
        })
      });
      return `Email schedule created. Next run: ${created.nextRunAt}.`;
    });
  }

  return (
    <main className="cc2-shell" style={{ padding: 28 }}>
      <section className="cc2-hero ric-hero">
        <div>
          <span><Settings2 size={16} /> ANALYTICS BUILDER</span>
          <h1>Report Builder, Dashboard Builder, and scheduled email reporting</h1>
          <p>Create reusable report definitions, assemble dashboards, and schedule executive email reports from saved views.</p>
        </div>
      </section>

      <ProductFlowNav
        current="builder"
        purpose="Use Builder when you want to create report definitions, combine them into dashboards, and schedule the output by email. It is the setup layer that feeds the command dashboard."
        nextSteps={[
          { label: 'Open command dashboard', href: '/dashboard', description: 'Review the dashboards and drilldowns your team reads every day.', badge: 'View output' },
          { label: 'Run Ops Actions', href: '/settings/actions', description: 'Turn insights into audited HubSpot actions when write scopes are ready.', badge: 'Act' },
          { label: 'Package billing plan', href: '/settings/billing', description: 'Move the configured reporting package into a sellable plan.', badge: 'Commercialize' }
        ]}
      />

      <section className="cc2-panel ric-panel">
        <header>
          <div>
            <h2>Workspace</h2>
            <p>Builder artifacts are tenant-scoped and saved through the existing reporting view system.</p>
          </div>
          <button type="button" onClick={() => void load()}><RefreshCw size={15} />Refresh</button>
        </header>
        <div className="cc2-panel-body" style={{ display: 'grid', gap: 12 }}>
          <Field label="Workspace">
            <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); void loadWorkspaceData(event.target.value); }}>
              {workspaces.map((row) => <option key={row.workspace.id} value={row.workspace.id}>{row.workspace.name}</option>)}
            </select>
          </Field>
          <div className="cc2-empty">
            {selectedWorkspace ? `Selected: ${selectedWorkspace.workspace.name}` : 'No connected workspace found.'}<br />
            Builder reports: {builderReports.length} · Builder dashboards: {builderDashboards.length} · Email schedules: {schedules.length}
          </div>
        </div>
      </section>

      {error ? <div className="dashboard-rollout-recovery" role="alert"><strong>Builder action failed.</strong><p>{error}</p></div> : null}
      {success ? <div className="dashboard-rollout-recovery saved-view-delete-guard" role="status"><strong>Done.</strong><p>{success}</p></div> : null}

      <div className="cc2-grid two">
        <Panel title="Report Builder" description="Create a reusable report definition from CRM object, metric, grouping, chart type, and date preset." icon={BarChart3}>
          <TextInput label="Report name" value={reportName} onChange={setReportName} />
          <SelectField label="Object" value={reportObjectType} onChange={setReportObjectType} options={objectTypes} />
          <SelectField label="Metric" value={reportMetric} onChange={setReportMetric} options={metrics} />
          <SelectField label="Group by" value={reportGroupBy} onChange={setReportGroupBy} options={groupByOptions} />
          <SelectField label="Chart" value={reportChartType} onChange={setReportChartType} options={chartTypes} />
          <SelectField label="Date preset" value={reportDatePreset} onChange={setReportDatePreset} options={datePresets} />
          <button className="cc2-primary" type="button" disabled={!workspaceId || busy === 'report'} onClick={() => void createReport()}>
            {busy === 'report' ? <RefreshCw className="cc2-spin" size={15} /> : <PlusCircle size={15} />}Create report
          </button>
        </Panel>

        <Panel title="Dashboard Builder" description="Assemble saved builder reports into a dashboard definition that can later be promoted into active dashboard layouts." icon={LayoutDashboard}>
          <TextInput label="Dashboard name" value={dashboardName} onChange={setDashboardName} />
          <TextInput label="Description" value={dashboardDescription} onChange={setDashboardDescription} />
          <Field label="Reports to include">
            <select multiple value={selectedReportIds} onChange={(event) => setSelectedReportIds(Array.from(event.target.selectedOptions).map((option) => option.value))}>
              {builderReports.map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}
            </select>
          </Field>
          <div className="cc2-empty">Select one or more builder reports. Hold Ctrl/Cmd to choose multiple reports.</div>
          <button className="cc2-primary" type="button" disabled={!workspaceId || busy === 'dashboard' || selectedReportIds.length === 0} onClick={() => void createDashboard()}>
            {busy === 'dashboard' ? <RefreshCw className="cc2-spin" size={15} /> : <LayoutDashboard size={15} />}Create dashboard
          </button>
        </Panel>

        <Panel title="Email Scheduling" description="Schedule any saved reporting view or builder dashboard for recurring executive delivery." icon={Mail}>
          <TextInput label="Schedule name" value={scheduleName} onChange={setScheduleName} />
          <Field label="Saved view / dashboard">
            <select value={scheduleViewId} onChange={(event) => setScheduleViewId(event.target.value)}>
              {savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
            </select>
          </Field>
          <SelectField label="Frequency" value={scheduleFrequency} onChange={setScheduleFrequency} options={['daily', 'weekly', 'monthly']} />
          <TextInput label="Timezone" value={scheduleTimezone} onChange={setScheduleTimezone} placeholder="Asia/Riyadh" />
          <TextInput label="Recipients" value={scheduleRecipients} onChange={setScheduleRecipients} placeholder="one@example.com, two@example.com" />
          <div className="cc2-grid two">
            <TextInput label="Hour" value={scheduleHour} onChange={setScheduleHour} type="number" />
            <TextInput label="Minute" value={scheduleMinute} onChange={setScheduleMinute} type="number" />
            <TextInput label="Weekday" value={scheduleWeekday} onChange={setScheduleWeekday} type="number" />
            <TextInput label="Month day" value={scheduleMonthday} onChange={setScheduleMonthday} type="number" />
          </div>
          <button className="cc2-primary" type="button" disabled={!workspaceId || !scheduleViewId || busy === 'schedule'} onClick={() => void createSchedule()}>
            {busy === 'schedule' ? <RefreshCw className="cc2-spin" size={15} /> : <CalendarClock size={15} />}Create email schedule
          </button>
        </Panel>

        <Panel title="Existing schedules" description="Latest configured email schedules for the selected workspace." icon={CalendarClock}>
          {schedules.length === 0 ? <div className="cc2-empty">No schedules yet.</div> : schedules.slice(0, 8).map((schedule) => (
            <article key={schedule.id} className="cc2-company-card">
              <strong>{schedule.name}</strong>
              <span>{schedule.savedViewName || 'Saved view'} · {schedule.frequency} · {schedule.enabled ? 'Enabled' : 'Disabled'}</span>
              <p>Next run: {schedule.nextRunAt || 'Not calculated yet'} · {schedule.timezone}</p>
            </article>
          ))}
        </Panel>
      </div>
    </main>
  );
}
