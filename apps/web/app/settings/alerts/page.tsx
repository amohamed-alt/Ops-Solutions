'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  CheckCircle2,
  FlaskConical,
  LoaderCircle,
  MailCheck,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2
} from 'lucide-react';

import styles from './alerts.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer' };
type Rule = {
  id: string; name: string; metric: string; comparator: string; threshold: number; recipients: string[];
  evaluationIntervalMinutes: number; cooldownMinutes: number; notifyOnRecovery: boolean; enabled: boolean;
  lastState: string; lastValue: number | null; lastEvaluatedAt?: string | null; lastTriggeredAt?: string | null;
};
type Event = {
  id: string; ruleId: string; state: string; metric: string; metricValue: number; threshold: number;
  comparator: string; deliveryStatus: string; provider?: string | null; error?: string | null; createdAt: string;
};
type Payload = {
  rules: Rule[];
  events: Event[];
  delivery: { configured: boolean; provider: string };
  metricCatalog: string[];
};

const roleRank = { viewer: 1, admin: 2, owner: 3 };
const METRIC_HELP: Record<string, string> = {
  overdue_tasks: 'Open CRM tasks whose due date is already in the past.',
  deals_at_risk: 'Open deals with overdue close dates or no future activity.',
  no_show_rate: 'No-show meeting outcomes as a percentage of meetings in the reporting period.',
  data_quality_score: 'Deterministic completeness score across required CRM fields.',
  sync_stale_hours: 'Hours since the newest synchronized CRM record.',
  delayed_renewals: 'Retention budget rows whose month passed without booked or cash value.',
  remaining_collection: 'Retention renewal value that has not yet been collected.',
  open_pipeline: 'Total value of currently open deals.'
};
const COMPARATORS = [
  ['gt', 'Above'], ['gte', 'At or above'], ['lt', 'Below'], ['lte', 'At or below'], ['eq', 'Equal to']
] as const;

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function number(value: number | null) {
  return value === null ? 'Not evaluated' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function time(value?: string | null) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function OperationalAlertsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState({
    name: 'Pipeline risk alert', metric: 'deals_at_risk', comparator: 'gte', threshold: '10',
    recipients: '', evaluationIntervalMinutes: '15', cooldownMinutes: '120', notifyOnRecovery: true
  });

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaceId, workspaces]);
  const canManage = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);

  async function readJson(response: Response) {
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || 'Operational alert request failed.');
    return result;
  }

  async function load(id = workspaceId) {
    if (!id) return;
    setLoading(true);
    setMessage('');
    try {
      const result = await fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/alerts`, { cache: 'no-store' }).then(readJson);
      setPayload(result as Payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load operational alerts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(readJson)
      .then((session) => {
        const rows = (session.workspaces ?? []) as Workspace[];
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((item) => item.id === remembered) ?? rows[0] ?? null;
        setWorkspaces(rows);
        setWorkspaceId(selected?.id ?? '');
      })
      .catch((error) => { setMessage(error.message); setLoading(false); });
  }, []);

  useEffect(() => { if (workspaceId) void load(workspaceId); }, [workspaceId]);

  async function createRule() {
    if (!workspaceId || !canManage || busy) return;
    setBusy('create'); setMessage(''); setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/alerts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          metric: form.metric,
          comparator: form.comparator,
          threshold: Number(form.threshold),
          recipients: form.recipients.split(/[;,\s]+/).filter(Boolean),
          evaluationIntervalMinutes: Number(form.evaluationIntervalMinutes),
          cooldownMinutes: Number(form.cooldownMinutes),
          notifyOnRecovery: form.notifyOnRecovery,
          enabled: true
        })
      });
      const created = await readJson(response) as Rule;
      setSuccess(`${created.name} is active and will be evaluated automatically.`);
      setForm((current) => ({ ...current, name: '', recipients: '' }));
      await load(workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to create the alert rule.');
    } finally { setBusy(''); }
  }

  async function updateRule(rule: Rule, patch: object) {
    if (!canManage || busy) return;
    setBusy(rule.id); setMessage(''); setSuccess('');
    try {
      await readJson(await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/alerts/${encodeURIComponent(rule.id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch)
      }));
      setSuccess(`${rule.name} updated.`);
      await load(workspaceId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to update the alert.'); }
    finally { setBusy(''); }
  }

  async function testRule(rule: Rule) {
    if (!canManage || busy) return;
    setBusy(`test-${rule.id}`); setMessage(''); setSuccess('');
    try {
      const result = await readJson(await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/alerts/${encodeURIComponent(rule.id)}/test`, { method: 'POST' }));
      setSuccess(result.notified ? `Test notification sent for ${rule.name}.` : `Rule evaluated at ${number(result.value)}. ${result.error || 'No email was delivered.'}`);
      await load(workspaceId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to test the alert.'); }
    finally { setBusy(''); }
  }

  async function deleteRule(rule: Rule) {
    if (!canManage || busy || !window.confirm(`Delete ${rule.name}?`)) return;
    setBusy(`delete-${rule.id}`); setMessage(''); setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/alerts/${encodeURIComponent(rule.id)}`, { method: 'DELETE' });
      if (!response.ok) await readJson(response);
      setSuccess(`${rule.name} deleted.`);
      await load(workspaceId);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete the alert.'); }
    finally { setBusy(''); }
  }

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/dashboard"><ArrowLeft size={16} />Dashboard</Link>
        <div><BellRing size={20} /><span><small>OPS INTELLIGENCE</small><strong>Operational Alerts</strong></span></div>
        <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </header>

      <section className={styles.hero}>
        <div><span>THRESHOLD AUTOMATION</span><h1>Get notified when revenue operations need attention.</h1><p>Rules evaluate synchronized HubSpot and Retention Budget metrics, suppress duplicate alerts with cooldowns, and send recovery messages when conditions return to normal.</p></div>
        <div className={styles.delivery}>{payload?.delivery.configured ? <MailCheck /> : <ShieldAlert />}<small>EMAIL DELIVERY</small><strong>{payload?.delivery.configured ? `${title(payload.delivery.provider)} connected` : 'Provider not configured'}</strong><span>{payload?.delivery.configured ? 'Automatic delivery is active.' : 'Rules and events work; email waits for Resend or Postmark configuration.'}</span></div>
      </section>

      {message ? <div className={styles.error}><AlertTriangle size={17} />{message}</div> : null}
      {success ? <div className={styles.success}><CheckCircle2 size={17} />{success}</div> : null}

      <section className={styles.builder}>
        <header><Plus /><div><h2>Create alert rule</h2><p>All thresholds are numeric, tenant-scoped and evaluated at a bounded interval.</p></div></header>
        {!canManage ? <div className={styles.readonly}>Viewer access can inspect rules and delivery history. Admin or owner access is required to change them.</div> : null}
        <div className={styles.form}>
          <label><span>Rule name</span><input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Pipeline risk alert" /></label>
          <label><span>Metric</span><select value={form.metric} onChange={(event) => setForm((current) => ({ ...current, metric: event.target.value }))}>{(payload?.metricCatalog || Object.keys(METRIC_HELP)).map((metric) => <option key={metric} value={metric}>{title(metric)}</option>)}</select><small>{METRIC_HELP[form.metric]}</small></label>
          <label><span>Condition</span><select value={form.comparator} onChange={(event) => setForm((current) => ({ ...current, comparator: event.target.value }))}>{COMPARATORS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>Threshold</span><input type="number" step="0.01" value={form.threshold} onChange={(event) => setForm((current) => ({ ...current, threshold: event.target.value }))} /></label>
          <label className={styles.recipients}><span>Recipients</span><input value={form.recipients} onChange={(event) => setForm((current) => ({ ...current, recipients: event.target.value }))} placeholder="manager@company.com, revops@company.com" /><small>Up to 20 email addresses.</small></label>
          <label><span>Evaluate every</span><select value={form.evaluationIntervalMinutes} onChange={(event) => setForm((current) => ({ ...current, evaluationIntervalMinutes: event.target.value }))}><option value="5">5 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="360">6 hours</option><option value="1440">Daily</option></select></label>
          <label><span>Cooldown</span><select value={form.cooldownMinutes} onChange={(event) => setForm((current) => ({ ...current, cooldownMinutes: event.target.value }))}><option value="15">15 minutes</option><option value="60">1 hour</option><option value="120">2 hours</option><option value="360">6 hours</option><option value="1440">24 hours</option><option value="10080">7 days</option></select></label>
          <label className={styles.check}><input type="checkbox" checked={form.notifyOnRecovery} onChange={(event) => setForm((current) => ({ ...current, notifyOnRecovery: event.target.checked }))} /><span>Notify when recovered</span></label>
        </div>
        <button className={styles.create} disabled={!canManage || !form.name.trim() || !form.recipients.trim() || Boolean(busy)} onClick={() => void createRule()}>{busy === 'create' ? <LoaderCircle className={styles.spin} /> : <Plus />}Create alert</button>
      </section>

      <section className={styles.rules}>
        <header><div><span>ACTIVE POLICY</span><h2>Alert rules</h2><p>{payload?.rules.length || 0} configured rules.</p></div><button onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? styles.spin : ''} />Refresh</button></header>
        <div>{loading && !payload ? <div className={styles.loading}><LoaderCircle className={styles.spin} />Loading rules…</div> : payload?.rules.map((rule) => <article key={rule.id} className={`${styles.rule} ${rule.enabled ? '' : styles.disabled}`}>
          <div className={styles.ruleTitle}><span className={rule.lastState === 'breached' ? styles.breached : rule.lastState === 'healthy' ? styles.healthy : styles.unknown}>{rule.lastState}</span><h3>{rule.name}</h3><p>{title(rule.metric)} {COMPARATORS.find(([value]) => value === rule.comparator)?.[1]?.toLowerCase()} {number(rule.threshold)}</p></div>
          <dl><div><dt>Current value</dt><dd>{number(rule.lastValue)}</dd></div><div><dt>Last evaluated</dt><dd>{time(rule.lastEvaluatedAt)}</dd></div><div><dt>Cooldown</dt><dd>{rule.cooldownMinutes} minutes</dd></div><div><dt>Recipients</dt><dd>{rule.recipients.length}</dd></div></dl>
          <div className={styles.ruleRecipients}>{rule.recipients.map((email) => <span key={email}>{email}</span>)}</div>
          <footer><label><input type="checkbox" checked={rule.enabled} disabled={!canManage || Boolean(busy)} onChange={(event) => void updateRule(rule, { enabled: event.target.checked })} /><span>{rule.enabled ? 'Enabled' : 'Paused'}</span></label><button onClick={() => void testRule(rule)} disabled={!canManage || Boolean(busy)}><FlaskConical />{busy === `test-${rule.id}` ? 'Testing' : 'Test now'}</button><button className={styles.delete} onClick={() => void deleteRule(rule)} disabled={!canManage || Boolean(busy)}><Trash2 />Delete</button></footer>
        </article>)}</div>
      </section>

      <section className={styles.events}>
        <header><h2>Delivery history</h2><p>Latest triggered, recovered and failed-delivery events.</p></header>
        <div>{payload?.events.map((event) => <article key={event.id}><span className={event.state === 'recovered' ? styles.eventRecovered : event.state === 'triggered' ? styles.eventTriggered : styles.eventFailed}>{title(event.state)}</span><div><strong>{title(event.metric)} · {number(event.metricValue)}</strong><small>{time(event.createdAt)} · threshold {title(event.comparator)} {number(event.threshold)}</small></div><div><strong>{title(event.deliveryStatus)}</strong><small>{event.provider || 'No provider'}{event.error ? ` · ${event.error}` : ''}</small></div></article>)}{payload && payload.events.length === 0 ? <div className={styles.loading}>No alert events yet.</div> : null}</div>
      </section>
    </main>
  );
}
