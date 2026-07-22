'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Database,
  History,
  Layers3,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Waypoints,
  X
} from 'lucide-react';

import styles from './mappings.module.css';

type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'viewer'; portalId?: number | null; hubspotStatus?: string | null };
type SemanticField = {
  semanticKey: string;
  label: string;
  description: string;
  objectTypes: string[];
  expectedTypes: string[];
  dependencies: string[];
};
type PropertyOption = { label?: string; value?: string; hidden?: boolean };
type Property = {
  objectType: string;
  propertyName: string;
  label: string;
  description: string;
  groupName?: string | null;
  fieldType?: string | null;
  dataType?: string | null;
  hubspotDefined: boolean;
  options: PropertyOption[];
  optionCount: number;
  sampleValues: string[];
  discoveredAt?: string;
};
type Suggestion = {
  id: string;
  semanticKey: string;
  objectType: string;
  propertyName: string;
  propertyLabel: string;
  propertyDescription: string;
  fieldType?: string | null;
  dataType?: string | null;
  confidence: number;
  confidenceBand: 'high' | 'medium' | 'low';
  reasons: string[];
  status: string;
  inferredValueMapping: Record<string, string>;
  sampleValues: string[];
};
type Mapping = {
  id: string;
  semanticKey: string;
  objectType: string;
  propertyName: string;
  propertyLabel: string;
  propertyDescription: string;
  fieldType?: string | null;
  dataType?: string | null;
  options: PropertyOption[];
  valueMapping: Record<string, string>;
  source: string;
  approvedBy?: string | null;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
};
type MappingHistory = {
  id: string;
  mappingId?: string | null;
  semanticKey: string;
  objectType: string;
  propertyName?: string | null;
  valueMapping: Record<string, string>;
  source: string;
  action: 'approved' | 'updated' | 'rolled_back' | 'removed';
  actorName?: string | null;
  actorEmail?: string | null;
  createdAt: string;
};
type WizardPayload = {
  workspaceId: string;
  role: Workspace['role'];
  summary: {
    semanticFields: number;
    totalSlots: number;
    mappedSlots: number;
    unmappedSlots: number;
    pendingSuggestions: number;
    highConfidenceSlots: number;
    staleMappings: number;
    discoveredProperties: number;
  };
  semanticFields: SemanticField[];
  properties: Property[];
  suggestions: Suggestion[];
  mappings: Mapping[];
  history: MappingHistory[];
  latestDiscovery?: { status?: string; error?: string; completed_at?: string } | null;
};
type Slot = {
  key: string;
  field: SemanticField;
  objectType: string;
  mapping: Mapping | null;
  suggestions: Suggestion[];
};

const ROLE_RANK = { viewer: 1, admin: 2, owner: 3 };

function title(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function when(value?: string | null) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function percent(value: number) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function slotStatus(slot: Slot) {
  if (slot.mapping?.stale) return 'stale';
  if (slot.mapping) return 'mapped';
  if (slot.suggestions.some((item) => item.status === 'suggested' && item.confidenceBand === 'high')) return 'recommended';
  return 'unmapped';
}

function mappingForProperty(slot: Slot, propertyName: string) {
  if (slot.mapping?.propertyName === propertyName) return { ...slot.mapping.valueMapping };
  const suggestion = slot.suggestions.find((item) => item.propertyName === propertyName);
  return { ...(suggestion?.inferredValueMapping ?? {}) };
}

export default function MappingWizardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [wizard, setWizard] = useState<WizardPayload | null>(null);
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedPropertyName, setSelectedPropertyName] = useState('');
  const [valueMapping, setValueMapping] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [propertySearch, setPropertySearch] = useState('');
  const [objectFilter, setObjectFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [newRaw, setNewRaw] = useState('');
  const [newTarget, setNewTarget] = useState('');

  const workspace = useMemo(() => workspaces.find((item) => item.id === workspaceId) ?? null, [workspaces, workspaceId]);
  const canEdit = Boolean(workspace && ROLE_RANK[workspace.role] >= ROLE_RANK.admin);

  const loadWizard = useCallback(async (id: string) => {
    setBusy('load');
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(id)}/mapping-wizard`, { cache: 'no-store' });
      const payload = await response.json() as WizardPayload & { message?: string };
      if (!response.ok) throw new Error(payload.message || 'Unable to load the mapping wizard.');
      setWizard(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load the mapping wizard.');
    } finally {
      setBusy('');
    }
  }, []);

  useEffect(() => {
    fetch('/api/customer/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sign in to configure HubSpot mappings.');
        const payload = await response.json();
        const rows = (payload.workspaces ?? []) as Workspace[];
        const requested = new URLSearchParams(window.location.search).get('workspaceId') ?? '';
        setWorkspaces(rows);
        setWorkspaceId(rows.some((item) => item.id === requested) ? requested : (rows[0]?.id ?? ''));
      })
      .catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    setWizard(null);
    setSelectedKey('');
    if (workspaceId) void loadWizard(workspaceId);
  }, [workspaceId, loadWizard]);

  const slots = useMemo<Slot[]>(() => {
    if (!wizard) return [];
    return wizard.semanticFields.flatMap((field) => field.objectTypes.map((objectType) => {
      const key = `${field.semanticKey}:${objectType}`;
      return {
        key,
        field,
        objectType,
        mapping: wizard.mappings.find((item) => item.semanticKey === field.semanticKey && item.objectType === objectType) ?? null,
        suggestions: wizard.suggestions
          .filter((item) => item.semanticKey === field.semanticKey && item.objectType === objectType)
          .sort((left, right) => right.confidence - left.confidence)
      };
    }));
  }, [wizard]);

  const selectedSlot = useMemo(() => slots.find((slot) => slot.key === selectedKey) ?? null, [slots, selectedKey]);
  const selectedProperty = useMemo(() => wizard?.properties.find((item) => item.objectType === selectedSlot?.objectType && item.propertyName === selectedPropertyName) ?? null, [wizard, selectedSlot, selectedPropertyName]);
  const slotHistory = useMemo(() => wizard?.history.filter((item) => item.semanticKey === selectedSlot?.field.semanticKey && item.objectType === selectedSlot?.objectType) ?? [], [wizard, selectedSlot]);

  const filteredSlots = useMemo(() => slots.filter((slot) => {
    const haystack = `${slot.field.label} ${slot.field.description} ${slot.objectType} ${slot.mapping?.propertyLabel ?? ''} ${slot.suggestions[0]?.propertyLabel ?? ''}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (objectFilter !== 'all' && slot.objectType !== objectFilter) return false;
    if (statusFilter !== 'all' && slotStatus(slot) !== statusFilter) return false;
    return true;
  }), [slots, search, objectFilter, statusFilter]);

  const candidateProperties = useMemo(() => {
    if (!wizard || !selectedSlot) return [];
    const confidence = new Map(selectedSlot.suggestions.map((item) => [item.propertyName, item.confidence]));
    return wizard.properties
      .filter((item) => item.objectType === selectedSlot.objectType)
      .filter((item) => {
        const haystack = `${item.label} ${item.propertyName} ${item.description} ${item.groupName ?? ''}`.toLowerCase();
        return !propertySearch || haystack.includes(propertySearch.toLowerCase());
      })
      .sort((left, right) => {
        if (left.propertyName === selectedSlot.mapping?.propertyName) return -1;
        if (right.propertyName === selectedSlot.mapping?.propertyName) return 1;
        return Number(confidence.get(right.propertyName) ?? 0) - Number(confidence.get(left.propertyName) ?? 0) || left.label.localeCompare(right.label);
      });
  }, [wizard, selectedSlot, propertySearch]);

  function openSlot(slot: Slot) {
    const recommended = slot.mapping?.propertyName || slot.suggestions.find((item) => item.status === 'suggested')?.propertyName || '';
    setSelectedKey(slot.key);
    setSelectedPropertyName(recommended);
    setValueMapping(recommended ? mappingForProperty(slot, recommended) : {});
    setPropertySearch('');
    setNewRaw('');
    setNewTarget('');
    setMessage('');
  }

  function chooseProperty(propertyName: string) {
    if (!selectedSlot) return;
    setSelectedPropertyName(propertyName);
    setValueMapping(mappingForProperty(selectedSlot, propertyName));
  }

  async function saveMapping() {
    if (!workspaceId || !selectedSlot || !selectedPropertyName || busy) return;
    setBusy('save');
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          semanticKey: selectedSlot.field.semanticKey,
          objectType: selectedSlot.objectType,
          propertyName: selectedPropertyName,
          valueMapping
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to save mapping.');
      setMessage(`${selectedSlot.field.label} mapping saved for ${title(selectedSlot.objectType)}.`);
      await loadWizard(workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save mapping.');
    } finally {
      setBusy('');
    }
  }

  async function removeMapping() {
    if (!workspaceId || !selectedSlot?.mapping || busy) return;
    setBusy('remove');
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ semanticKey: selectedSlot.field.semanticKey, objectType: selectedSlot.objectType })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Unable to remove mapping.');
      }
      setSelectedKey('');
      setMessage('Mapping removed. Suggested candidates are available again.');
      await loadWizard(workspaceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to remove mapping.');
    } finally {
      setBusy('');
    }
  }

  async function rollback(version: MappingHistory) {
    if (!workspaceId || !selectedSlot || !version.propertyName || busy) return;
    setBusy(`rollback-${version.id}`);
    setMessage('');
    try {
      const response = await fetch(`/api/customer/workspaces/${encodeURIComponent(workspaceId)}/mapping-wizard`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', semanticKey: selectedSlot.field.semanticKey, objectType: selectedSlot.objectType, versionId: version.id })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'Unable to restore mapping version.');
      setMessage(`Restored ${version.propertyName}.`);
      await loadWizard(workspaceId);
      setSelectedPropertyName(version.propertyName);
      setValueMapping({ ...version.valueMapping });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to restore mapping version.');
    } finally {
      setBusy('');
    }
  }

  function addCustomValue() {
    const raw = newRaw.trim();
    const target = newTarget.trim();
    if (!raw || !target) return;
    setValueMapping((current) => ({ ...current, [raw]: target }));
    setNewRaw('');
    setNewTarget('');
  }

  const objectTypes = useMemo(() => [...new Set(slots.map((slot) => slot.objectType))].sort(), [slots]);

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <span>SEMANTIC MAPPING</span>
          <h1>Teach the platform how this company names its CRM.</h1>
          <p>Review deterministic suggestions, map custom HubSpot properties, normalize business values, and safely restore previous versions.</p>
        </div>
        <div className={styles.headerActions}>
          <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} aria-label="Company workspace">
            {workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button type="button" onClick={() => workspaceId && void loadWizard(workspaceId)} disabled={!workspaceId || Boolean(busy)}>
            <RefreshCw className={busy === 'load' ? styles.spin : ''} /> Refresh
          </button>
        </div>
      </header>

      {message ? <div className={styles.message}>{message}</div> : null}
      {!wizard ? (
        <section className={styles.loading}><LoaderCircle className={styles.spin} /><strong>Analyzing discovered CRM properties…</strong><p>Comparing labels, internal names, types, options and synchronized sample values.</p></section>
      ) : (
        <>
          <section className={styles.summary}>
            <article><span className={styles.indigo}><Waypoints /></span><div><strong>{wizard.summary.mappedSlots}/{wizard.summary.totalSlots}</strong><small>Mapping coverage</small></div></article>
            <article><span className={styles.green}><CheckCircle2 /></span><div><strong>{wizard.summary.mappedSlots}</strong><small>Approved mappings</small></div></article>
            <article><span className={styles.violet}><Sparkles /></span><div><strong>{wizard.summary.highConfidenceSlots}</strong><small>High-confidence recommendations</small></div></article>
            <article><span className={wizard.summary.staleMappings ? styles.red : styles.cyan}><AlertTriangle /></span><div><strong>{wizard.summary.staleMappings}</strong><small>Stale mappings</small></div></article>
            <article><span className={styles.amber}><Database /></span><div><strong>{wizard.summary.discoveredProperties}</strong><small>Discovered properties</small></div></article>
          </section>

          <section className={styles.notice}>
            <ShieldCheck />
            <div><strong>No low-confidence property is approved automatically.</strong><p>Owner or admin review is required before a mapping changes reporting behavior. Every change is versioned and audited.</p></div>
            <span>{workspace?.role ? title(workspace.role) : 'Viewer'}</span>
          </section>

          <section className={styles.toolbar}>
            <label><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search semantic fields or properties" /></label>
            <select value={objectFilter} onChange={(event) => setObjectFilter(event.target.value)}><option value="all">All objects</option>{objectTypes.map((item) => <option key={item} value={item}>{title(item)}</option>)}</select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="mapped">Mapped</option><option value="recommended">Recommended</option><option value="unmapped">Unmapped</option><option value="stale">Stale</option></select>
            <span>{filteredSlots.length} mapping slots</span>
          </section>

          <section className={styles.grid}>
            {filteredSlots.map((slot) => {
              const status = slotStatus(slot);
              const suggestion = slot.suggestions.find((item) => item.status === 'suggested') ?? slot.suggestions[0];
              return (
                <button type="button" className={styles.card} key={slot.key} onClick={() => openSlot(slot)}>
                  <div className={styles.cardTop}>
                    <span className={`${styles.status} ${styles[status]}`}>{status === 'recommended' ? 'Review recommendation' : title(status)}</span>
                    <small>{title(slot.objectType)}</small>
                  </div>
                  <div className={styles.cardTitle}><span><Layers3 /></span><div><h2>{slot.field.label}</h2><p>{slot.field.description}</p></div></div>
                  {slot.mapping ? (
                    <div className={styles.selection}><strong>{slot.mapping.propertyLabel}</strong><code>{slot.mapping.propertyName}</code><small>{slot.mapping.stale ? 'Missing from latest discovery' : `Updated ${when(slot.mapping.updatedAt)}`}</small></div>
                  ) : suggestion ? (
                    <div className={styles.selection}><strong>{suggestion.propertyLabel}</strong><code>{suggestion.propertyName}</code><small>{percent(suggestion.confidence)} confidence · {suggestion.confidenceBand}</small></div>
                  ) : (
                    <div className={styles.selection}><strong>No recommendation yet</strong><small>Choose from discovered {title(slot.objectType)} properties.</small></div>
                  )}
                  <div className={styles.dependencies}>{slot.field.dependencies.slice(0, 2).map((item) => <span key={item}>{item}</span>)}</div>
                  <div className={styles.cardAction}>Configure mapping <ArrowRight /></div>
                </button>
              );
            })}
            {filteredSlots.length === 0 ? <div className={styles.empty}><CircleHelp /><h2>No mapping slots match these filters.</h2><p>Reset the search or choose another object and status.</p></div> : null}
          </section>
        </>
      )}

      {selectedSlot && wizard ? (
        <div className={styles.backdrop} onMouseDown={(event) => event.target === event.currentTarget && setSelectedKey('')}>
          <aside className={styles.drawer}>
            <header className={styles.drawerHeader}>
              <div><span>{title(selectedSlot.objectType)} PROPERTY</span><h2>{selectedSlot.field.label}</h2><p>{selectedSlot.field.description}</p></div>
              <button type="button" onClick={() => setSelectedKey('')} aria-label="Close mapping editor"><X /></button>
            </header>

            <div className={styles.drawerBody}>
              <section className={styles.impact}>
                <strong>Reports affected</strong>
                <div>{selectedSlot.field.dependencies.map((item) => <span key={item}>{item}</span>)}</div>
              </section>

              <section className={styles.editorSection}>
                <div className={styles.sectionTitle}><div><h3>1. Choose the HubSpot property</h3><p>Recommendations are ranked by deterministic metadata and option matching.</p></div><Sparkles /></div>
                <label className={styles.propertySearch}><Search /><input value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder={`Search ${title(selectedSlot.objectType)} properties`} /></label>
                <div className={styles.propertyList}>
                  {candidateProperties.slice(0, 80).map((property) => {
                    const suggestion = selectedSlot.suggestions.find((item) => item.propertyName === property.propertyName);
                    const selected = property.propertyName === selectedPropertyName;
                    return (
                      <button type="button" key={property.propertyName} className={selected ? styles.propertyActive : ''} onClick={() => chooseProperty(property.propertyName)}>
                        <span>{selected ? <CheckCircle2 /> : <Database />}</span>
                        <div><strong>{property.label}</strong><code>{property.propertyName}</code><small>{property.dataType || 'unknown type'} · {property.hubspotDefined ? 'HubSpot property' : 'Custom property'}</small></div>
                        {suggestion ? <b className={styles[suggestion.confidenceBand]}>{percent(suggestion.confidence)}</b> : null}
                      </button>
                    );
                  })}
                  {candidateProperties.length === 0 ? <p className={styles.noProperties}>No discovered property matches this search.</p> : null}
                </div>
              </section>

              {selectedProperty ? (
                <>
                  <section className={styles.editorSection}>
                    <div className={styles.sectionTitle}><div><h3>2. Validate evidence</h3><p>Check metadata and real synchronized values before approval.</p></div><ShieldCheck /></div>
                    <div className={styles.evidenceGrid}>
                      <article><span>Internal name</span><code>{selectedProperty.propertyName}</code></article>
                      <article><span>Type</span><strong>{selectedProperty.dataType || selectedProperty.fieldType || 'Unknown'}</strong></article>
                      <article><span>Source</span><strong>{selectedProperty.hubspotDefined ? 'HubSpot-defined' : 'Custom'}</strong></article>
                      <article><span>Options</span><strong>{selectedProperty.optionCount}</strong></article>
                    </div>
                    {selectedProperty.description ? <p className={styles.propertyDescription}>{selectedProperty.description}</p> : null}
                    <div className={styles.samples}><strong>Sample values</strong><div>{selectedProperty.sampleValues.length ? selectedProperty.sampleValues.map((item) => <span key={item}>{item}</span>) : <small>No synchronized values available yet.</small>}</div></div>
                    {selectedSlot.suggestions.find((item) => item.propertyName === selectedProperty.propertyName)?.reasons.length ? <div className={styles.reasons}><strong>Why it was suggested</strong>{selectedSlot.suggestions.find((item) => item.propertyName === selectedProperty.propertyName)?.reasons.map((reason) => <p key={reason}><CheckCircle2 />{reason}</p>)}</div> : null}
                  </section>

                  <section className={styles.editorSection}>
                    <div className={styles.sectionTitle}><div><h3>3. Normalize values</h3><p>Translate portal-specific labels into stable business values used by reports.</p></div><Waypoints /></div>
                    {selectedProperty.options.length ? (
                      <div className={styles.valueTable}>
                        <div><span>HubSpot value</span><span>Normalized value</span></div>
                        {selectedProperty.options.filter((option) => !option.hidden).map((option) => {
                          const raw = String(option.value ?? option.label ?? '');
                          return <label key={raw}><span><strong>{option.label || raw}</strong><code>{raw}</code></span><input value={valueMapping[raw] ?? ''} onChange={(event) => setValueMapping((current) => ({ ...current, [raw]: event.target.value }))} placeholder="Leave blank if no normalization is needed" /></label>;
                        })}
                      </div>
                    ) : (
                      <div className={styles.customValues}>
                        {Object.entries(valueMapping).map(([raw, target]) => <div key={raw}><code>{raw}</code><input value={target} onChange={(event) => setValueMapping((current) => ({ ...current, [raw]: event.target.value }))} /><button type="button" onClick={() => setValueMapping((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== raw)))}><Trash2 /></button></div>)}
                        <div><input value={newRaw} onChange={(event) => setNewRaw(event.target.value)} placeholder="Raw HubSpot value" /><input value={newTarget} onChange={(event) => setNewTarget(event.target.value)} placeholder="Normalized value" /><button type="button" onClick={addCustomValue}>Add</button></div>
                      </div>
                    )}
                  </section>

                  <section className={styles.editorSection}>
                    <div className={styles.sectionTitle}><div><h3>Version history</h3><p>Every approval, update, rollback and removal remains traceable.</p></div><History /></div>
                    <div className={styles.historyList}>
                      {slotHistory.map((version) => <article key={version.id}><span className={styles[version.action]}>{version.action === 'rolled_back' ? <RotateCcw /> : version.action === 'removed' ? <Trash2 /> : <CheckCircle2 />}</span><div><strong>{version.propertyName || 'Mapping removed'}</strong><small>{title(version.action)} by {version.actorName || version.actorEmail || 'Workspace member'} · {when(version.createdAt)}</small></div>{canEdit && version.propertyName ? <button type="button" disabled={Boolean(busy)} onClick={() => void rollback(version)}><RotateCcw className={busy === `rollback-${version.id}` ? styles.spin : ''} />Restore</button> : null}</article>)}
                      {slotHistory.length === 0 ? <p className={styles.noHistory}>No saved versions for this mapping yet.</p> : null}
                    </div>
                  </section>
                </>
              ) : null}
            </div>

            <footer className={styles.drawerFooter}>
              <div>{!canEdit ? <span><ShieldCheck />Viewer access is read-only.</span> : selectedSlot.mapping ? <button className={styles.danger} type="button" onClick={() => void removeMapping()} disabled={Boolean(busy)}><Trash2 />Remove mapping</button> : null}</div>
              <div><button type="button" onClick={() => setSelectedKey('')}>Cancel</button><button className={styles.primary} type="button" onClick={() => void saveMapping()} disabled={!canEdit || !selectedPropertyName || Boolean(busy)}><Save className={busy === 'save' ? styles.spin : ''} />Save mapping</button></div>
            </footer>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
