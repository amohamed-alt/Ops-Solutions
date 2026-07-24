'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  Search,
  UploadCloud
} from 'lucide-react';

import styles from './retention-budget.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer'; portalId?: string | number | null };
type BudgetImport = {
  id: string; fileName: string; currency: string; status: string; active: boolean;
  rowCount: number; validRowCount: number; rejectedRowCount: number; duplicateRowCount: number;
  matchedCompanyCount: number; matchedDealCount: number; validationErrors: Array<{ row: number; message: string }>;
  createdAt: string; activatedAt?: string | null;
};
type BudgetRow = {
  id: string; companyName: string; companyDomain?: string | null; product: string; budgetMonth: string;
  renewalValue: number; bookedValue: number; cashCollected: number; remainingCollection: number;
  rmCsm?: string | null; expectedLost: boolean; accountStatus?: string | null; matchStatus: string;
  matchedCompanyId?: string | null; matchedDealId?: string | null; duplicateCount: number;
};
type Report = {
  configured: boolean;
  import: BudgetImport | null;
  summary: Record<string, number>;
  breakdowns: {
    products?: Array<{ key: string; accounts: number; value: number }>;
    managers?: Array<{ key: string; accounts: number; value: number }>;
    months?: Array<{ key: string; accounts: number; value: number }>;
  };
  rows: BudgetRow[];
  total: number;
  hasMore: boolean;
};
type Validation = {
  headers: string[]; mapping: Record<string, string | null>; currency: string; totalRows: number;
  validRowCount: number; rejectedRowCount: number; duplicateRowCount: number;
  errors: Array<{ row: number; message: string }>;
  preview: Array<Record<string, unknown>>;
};

const MAPPING_FIELDS = [
  ['companyName', 'Company name', true], ['companyDomain', 'Company domain', false],
  ['product', 'Product', true], ['budgetMonth', 'Budget month', true],
  ['renewalValue', 'Renewal value', true], ['bookedValue', 'Booked value', false],
  ['cashCollected', 'Cash collected', false], ['rmCsm', 'RM / CSM', false],
  ['expectedLost', 'Expected lost', false], ['accountStatus', 'Account status', false],
  ['notes', 'Notes', false]
] as const;
const CATEGORIES = [
  ['all', 'All budget rows'], ['upcoming', 'Upcoming'], ['delayed', 'Delayed'],
  ['renewed_late', 'Renewed late'], ['lost', 'Lost / expected lost'],
  ['matched', 'Matched'], ['unmatched', 'Unmatched']
] as const;
const roleRank = { viewer: 1, admin: 2, owner: 3 };

function money(value: number, currency = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value || 0); }
  catch { return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0); }
}

function integer(value: number) { return new Intl.NumberFormat('en-US').format(value || 0); }
function title(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }

function parseHeaders(csv: string) {
  const line = csv.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
  const headers: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted && character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { headers.push(cell.trim()); cell = ''; }
    else cell += character;
  }
  headers.push(cell.trim());
  return headers.filter(Boolean);
}

function suggestMapping(headers: string[]) {
  const normalized = headers.map((header) => ({ header, key: header.toLowerCase().replace(/[^a-z0-9]+/g, '') }));
  const aliases: Record<string, string[]> = {
    companyName: ['companyname', 'company', 'accountname', 'clientname', 'client'],
    companyDomain: ['companydomain', 'domain', 'website'],
    product: ['product', 'service', 'package', 'solution'],
    budgetMonth: ['budgetmonth', 'renewalmonth', 'renewaldate', 'month'],
    renewalValue: ['renewalvalue', 'budgetvalue', 'budget', 'arr', 'value'],
    bookedValue: ['bookedvalue', 'booked', 'booking'],
    cashCollected: ['cashcollected', 'collected', 'cash', 'collection'],
    rmCsm: ['rmcsm', 'rm', 'csm', 'accountmanager', 'manager'],
    expectedLost: ['expectedlost', 'expectedtobelost', 'atrisk'],
    accountStatus: ['accountstatus', 'status', 'customerstatus'],
    notes: ['notes', 'note', 'comments']
  };
  return Object.fromEntries(MAPPING_FIELDS.map(([field]) => [field, normalized.find((item) => aliases[field]?.includes(item.key))?.header || '']));
}

function hubSpotUrl(portalId: string, type: 'company' | 'deal', id?: string | null) {
  return portalId && id ? `https://app.hubspot.com/contacts/${encodeURIComponent(portalId)}/${type}/${encodeURIComponent(id)}` : '';
}

export default function RetentionBudgetPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [imports, setImports] = useState<BudgetImport[]>([]);
  const [category, setCategory] = useState('all');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState('');
  const [fileName, setFileName] = useState('');
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [currency, setCurrency] = useState('USD');
  const [validation, setValidation] = useState<Validation | null>(null);

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaceId, workspaces]);
  const canManage = Boolean(workspace && roleRank[workspace.role] >= roleRank.admin);

  async function readJson(response: Response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || 'The retention budget request failed.');
    return payload;
  }

  async function loadData(id = workspaceId, nextCategory = category, nextOffset = offset) {
    if (!id) return;
    setLoading(true);
    setMessage('');
    try {
      const query = new URLSearchParams({ category: nextCategory, offset: String(nextOffset), limit: '50' });
      const [reportPayload, importPayload] = await Promise.all([
        fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/retention-budget/report?${query}`, { cache: 'no-store' }).then(readJson),
        fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/retention-budget/imports`, { cache: 'no-store' }).then(readJson)
      ]);
      setReport(reportPayload as Report);
      setImports(importPayload.results ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load retention reporting.');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(readJson)
      .then((payload) => {
        const rows = (payload.workspaces ?? []) as Workspace[];
        const remembered = window.localStorage.getItem('ops:last-dashboard-workspace') || '';
        const selected = rows.find((item) => item.id === remembered) ?? rows[0] ?? null;
        setWorkspaces(rows);
        setWorkspaceId(selected?.id ?? '');
      })
      .catch((error) => { setMessage(error.message); setLoading(false); });
  }, []);

  useEffect(() => { if (workspaceId) { setOffset(0); void loadData(workspaceId, category, 0); } }, [workspaceId]);

  async function selectFile(file?: File) {
    if (!file) return;
    const text = await file.text();
    const nextHeaders = parseHeaders(text);
    setFileName(file.name);
    setCsv(text);
    setHeaders(nextHeaders);
    setMapping(suggestMapping(nextHeaders));
    setValidation(null);
    setMessage('');
    setSuccess('');
  }

  async function validate() {
    if (!workspaceId || !csv || busy) return;
    setBusy('validate'); setMessage(''); setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/retention-budget/validate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, fileName, mapping, currency })
      });
      const payload = await readJson(response) as Validation;
      setValidation(payload);
      setSuccess(`Validated ${payload.validRowCount} unique rows. ${payload.duplicateRowCount} duplicates were consolidated.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to validate the budget.'); }
    finally { setBusy(''); }
  }

  async function importBudget() {
    if (!workspaceId || !validation || busy) return;
    setBusy('import'); setMessage(''); setSuccess('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/retention-budget/imports`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ csv, fileName, mapping, currency, activate: true })
      });
      const payload = await readJson(response) as BudgetImport;
      setSuccess(`Imported and activated ${payload.validRowCount} retention budget rows. ${payload.matchedCompanyCount} companies matched to HubSpot.`);
      setValidation(null); setCsv(''); setHeaders([]); setFileName('');
      await loadData(workspaceId, 'all', 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to import the budget.'); }
    finally { setBusy(''); }
  }

  async function activate(item: BudgetImport) {
    setBusy(item.id); setMessage(''); setSuccess('');
    try {
      await readJson(await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/retention-budget/imports/${encodeURIComponent(item.id)}/activate`, { method: 'POST' }));
      setSuccess(`${item.fileName} is now the active retention source of truth.`);
      await loadData(workspaceId, category, 0);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to activate the import.'); }
    finally { setBusy(''); }
  }

  async function changeCategory(next: string) {
    setCategory(next); setOffset(0); await loadData(workspaceId, next, 0);
  }

  const summaryCards = report ? [
    ['renewalValue', 'Renewal value'], ['bookedValue', 'Booked'], ['cashCollected', 'Cash collected'],
    ['remainingCollection', 'Remaining collection'], ['upcoming', 'Upcoming'], ['delayed', 'Delayed'],
    ['renewedLate', 'Renewed late'], ['lost', 'Lost / expected lost'], ['notInBudget', 'Not in budget'], ['unmatched', 'Unmatched']
  ] : [];

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link href="/dashboard"><ArrowLeft size={16} />Dashboard</Link>
        <div><CircleDollarSign size={20} /><span><small>OPS INTELLIGENCE</small><strong>Retention Budget</strong></span></div>
        <label><span>Company</span><select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </header>

      <section className={styles.hero}>
        <div><span>RETENTION SOURCE OF TRUTH</span><h1>Budget, renewal, booked and cash intelligence in one view.</h1><p>Import the approved budget sheet, consolidate company + product duplicates, match accounts and deals to HubSpot, then classify upcoming, delayed, renewed-late and lost renewals deterministically.</p></div>
        <div className={styles.heroStats}><strong>{report?.configured ? report.import?.fileName : 'Not configured'}</strong><span>{report?.configured ? `${integer(report.import?.validRowCount || 0)} active budget rows` : 'Upload a CSV to begin'}</span><a href={workspaceId ? `/api/customer/workspaces/${encodeURIComponent(workspaceId)}/retention-budget/template.csv` : '#'}><Download size={14} />Template CSV</a></div>
      </section>

      {message ? <div className={styles.error}><AlertTriangle size={17} />{message}</div> : null}
      {success ? <div className={styles.success}><CheckCircle2 size={17} />{success}</div> : null}

      <section className={styles.importer}>
        <header><UploadCloud /><div><h2>Import and validate budget</h2><p>CSV stays tenant-scoped. Required fields are mapped explicitly before any rows are written.</p></div></header>
        {!canManage ? <p className={styles.readonly}>Viewer access can inspect retention reports. Admin or owner access is required to import or activate a budget.</p> : null}
        <div className={styles.importGrid}>
          <label className={styles.drop}><input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event.target.files?.[0])} disabled={!canManage} /><FileSpreadsheet /><strong>{fileName || 'Choose retention budget CSV'}</strong><span>Up to 8 MiB and 20,000 rows</span></label>
          <div className={styles.mapping}>
            <label><span>Currency</span><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
            {MAPPING_FIELDS.map(([field, label, required]) => <label key={field}><span>{label}{required ? ' *' : ''}</span><select value={mapping[field] || ''} onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}><option value="">Not mapped</option>{headers.map((header) => <option key={header}>{header}</option>)}</select></label>)}
          </div>
        </div>
        <div className={styles.importActions}><button disabled={!canManage || !csv || Boolean(busy)} onClick={() => void validate()}>{busy === 'validate' ? <LoaderCircle className={styles.spin} /> : <Search />}Validate rows</button><button disabled={!canManage || !validation || validation.validRowCount === 0 || Boolean(busy)} onClick={() => void importBudget()}>{busy === 'import' ? <LoaderCircle className={styles.spin} /> : <UploadCloud />}Import & activate</button></div>
        {validation ? <div className={styles.validation}><article><strong>{integer(validation.validRowCount)}</strong><span>valid unique rows</span></article><article><strong>{integer(validation.duplicateRowCount)}</strong><span>duplicates consolidated</span></article><article><strong>{integer(validation.rejectedRowCount)}</strong><span>rejected rows</span></article>{validation.errors.length ? <div><b>Validation issues</b>{validation.errors.slice(0, 10).map((error) => <p key={`${error.row}-${error.message}`}>Row {error.row}: {error.message}</p>)}</div> : null}</div> : null}
      </section>

      {report?.configured ? <>
        <section className={styles.cards}>{summaryCards.map(([key, label]) => { const value = report.summary[key] || 0; const financial = key.toLowerCase().includes('value') || key.toLowerCase().includes('booked') || key.toLowerCase().includes('cash') || key.toLowerCase().includes('collection'); return <article key={key}><small>{label}</small><strong>{financial ? money(value, report.import?.currency) : integer(value)}</strong><span>{key === 'remainingCollection' ? 'Budget minus collected cash' : 'Active budget source'}</span></article>; })}</section>

        <section className={styles.reportPanel}>
          <header><div><span>ACCOUNT CLASSIFICATION</span><h2>Retention accounts</h2><p>{integer(report.total)} rows match the selected category.</p></div><div><select value={category} onChange={(event) => void changeCategory(event.target.value)}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button onClick={() => void loadData()} disabled={loading}><RefreshCw className={loading ? styles.spin : ''} />Refresh</button></div></header>
          <div className={styles.table}>{loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} />Loading retention rows…</div> : report.rows.map((row) => {
            const companyUrl = hubSpotUrl(String(workspace?.portalId || ''), 'company', row.matchedCompanyId);
            const dealUrl = hubSpotUrl(String(workspace?.portalId || ''), 'deal', row.matchedDealId);
            return <article key={row.id}><div><strong>{row.companyName}</strong><small>{row.companyDomain || 'No domain'} · {row.matchStatus.replaceAll('_', ' ')}</small><span>{companyUrl ? <a href={companyUrl} target="_blank" rel="noreferrer">Company <ExternalLink size={11} /></a> : null}{dealUrl ? <a href={dealUrl} target="_blank" rel="noreferrer">Deal <ExternalLink size={11} /></a> : null}</span></div><span><b>Product</b><strong>{row.product}</strong><small>{new Date(row.budgetMonth).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</small></span><span><b>Budget</b><strong>{money(row.renewalValue, report.import?.currency)}</strong><small>{row.duplicateCount > 1 ? `${row.duplicateCount} rows consolidated` : 'Single budget row'}</small></span><span><b>Booked / Cash</b><strong>{money(row.bookedValue, report.import?.currency)} / {money(row.cashCollected, report.import?.currency)}</strong><small>{money(row.remainingCollection, report.import?.currency)} remaining</small></span><span><b>Owner / Status</b><strong>{row.rmCsm || 'Unassigned'}</strong><small>{row.expectedLost ? 'Expected lost' : row.accountStatus || 'No status'}</small></span></article>;
          })}</div>
          <footer><button disabled={loading || offset === 0} onClick={() => { const next = Math.max(0, offset - 50); setOffset(next); void loadData(workspaceId, category, next); }}><ChevronLeft />Previous</button><span>{report.total ? `${offset + 1}–${Math.min(report.total, offset + report.rows.length)} of ${integer(report.total)}` : '0 rows'}</span><button disabled={loading || !report.hasMore} onClick={() => { const next = offset + 50; setOffset(next); void loadData(workspaceId, category, next); }}>Next<ChevronRight /></button></footer>
        </section>

        <section className={styles.breakdowns}>{[['products', 'By product'], ['managers', 'By RM / CSM'], ['months', 'By budget month']].map(([key, label]) => <article key={key}><header><h3>{label}</h3></header>{(report.breakdowns[key as keyof Report['breakdowns']] || []).slice(0, 12).map((row) => <div key={row.key}><span>{row.key}</span><i><b style={{ width: `${Math.max(4, row.value / Math.max(1, (report.breakdowns[key as keyof Report['breakdowns']] || [])[0]?.value || 1) * 100)}%` }} /></i><strong>{money(row.value, report.import?.currency)}</strong></div>)}</article>)}</section>
      </> : <section className={styles.empty}><FileSpreadsheet /><h2>No active retention budget</h2><p>Download the template, map your actual budget columns, validate the data, then activate the import.</p></section>}

      <section className={styles.history}><header><h2>Import history</h2><p>Only one source can be active. Previous imports remain auditable and can be reactivated.</p></header><div>{imports.map((item) => <article key={item.id} className={item.active ? styles.activeImport : ''}><div><span>{item.active ? 'ACTIVE' : item.status.toUpperCase()}</span><strong>{item.fileName}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.currency}</small></div><dl><div><dt>Rows</dt><dd>{integer(item.validRowCount)}</dd></div><div><dt>Companies matched</dt><dd>{integer(item.matchedCompanyCount)}</dd></div><div><dt>Deals matched</dt><dd>{integer(item.matchedDealCount)}</dd></div><div><dt>Rejected</dt><dd>{integer(item.rejectedRowCount)}</dd></div></dl>{!item.active ? <button disabled={!canManage || Boolean(busy)} onClick={() => void activate(item)}>{busy === item.id ? <LoaderCircle className={styles.spin} /> : null}Activate</button> : null}</article>)}</div></section>
    </main>
  );
}
