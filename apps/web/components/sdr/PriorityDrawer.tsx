'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, UsersRound, X } from 'lucide-react';

import type { OwnerActivityDatum, PriorityDrilldown } from './types';
import { humanize } from './WidgetKit';

function shortDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function PriorityDrawer({
  drilldown,
  portalId,
  owners,
  title = 'Priority leads needing attention',
  description = 'Live HubSpot contacts behind the selected execution signal.',
  onClose
}: {
  drilldown: PriorityDrilldown;
  portalId?: number | string | null;
  owners: OwnerActivityDatum[];
  title?: string;
  description?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const ownerIndex = useMemo(() => Object.fromEntries(owners.map((item) => [String(item.owner?.id ?? item.key), item.owner])), [owners]);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return drilldown.results;
    return drilldown.results.filter((row) => JSON.stringify(row).toLowerCase().includes(term));
  }, [drilldown.results, query]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    document.body.classList.add('sdr-drawer-open');
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.body.classList.remove('sdr-drawer-open');
    };
  }, [onClose]);

  return (
    <div className="sdr-drilldown-layer" role="dialog" aria-modal="true" aria-label={title}>
      <button className="sdr-drilldown-backdrop" onClick={onClose} aria-label="Close details" />
      <aside className="sdr-drilldown-drawer">
        <header className="sdr-drilldown-header">
          <div><span>DRILL-DOWN · LIVE HUBSPOT DATA</span><h2>{title}</h2><p>{description}</p></div>
          <button className="sdr-drawer-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </header>
        <div className="sdr-drilldown-toolbar">
          <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search these records…" /></label>
          <div><strong>{filtered.length}</strong><span>{query ? `matching of ${drilldown.results.length}` : 'records on this page'}</span></div>
        </div>
        <div className="sdr-drilldown-list">
          {!filtered.length ? <div className="sdr-drawer-empty"><Search size={26} /><strong>No matching records</strong><span>Try a different search inside this result set.</span></div> : null}
          {filtered.map((row) => {
            const properties = row.properties ?? {};
            const name = [properties.firstname, properties.lastname].filter(Boolean).join(' ') || `Contact ${row.id}`;
            const owner = ownerIndex[String(properties.hubspot_owner_id ?? '')];
            const hubspotUrl = portalId ? `https://app.hubspot.com/contacts/${portalId}/contact/${row.id}` : null;
            return (
              <article className="sdr-drawer-record-card" key={row.id}>
                <div className="sdr-drawer-record-main">
                  <span className="sdr-drawer-record-type"><UsersRound size={14} />Contact</span>
                  <h3>{name}</h3>
                  <p>{properties.jobtitle || 'No job title'}{properties.company ? ` · ${properties.company}` : ''}</p>
                </div>
                <div className="sdr-drawer-record-fields">
                  <span><b>Country</b>{properties.country || '—'}</span>
                  <span><b>Owner</b>{owner?.name || properties.hubspot_owner_id || 'Unassigned'}</span>
                  <span><b>Lead status</b>{humanize(properties.hs_lead_status || properties.lifecyclestage)}</span>
                  <span><b>Email</b>{properties.email || '—'}</span>
                  <span><b>Phone</b>{properties.phone || properties.mobilephone || '—'}</span>
                  <span><b>Last contacted</b>{shortDate(properties.notes_last_contacted)}</span>
                </div>
                <div className="sdr-drawer-record-actions">
                  {hubspotUrl ? <a href={hubspotUrl} target="_blank" rel="noreferrer">Open record in HubSpot<ExternalLink size={13} /></a> : <span>HubSpot link unavailable</span>}
                </div>
              </article>
            );
          })}
        </div>
        <footer className="sdr-drilldown-footer"><span>Showing tenant-isolated CRM records behind this widget.</span><small>{drilldown.fallback ? 'Attention fallback is active until lead-quality mapping is approved.' : 'Priority mapping is active.'}</small></footer>
      </aside>
    </div>
  );
}
