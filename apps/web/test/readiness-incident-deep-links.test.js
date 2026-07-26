import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageUrl = new URL('../app/settings/readiness/page.tsx', import.meta.url);
const source = readFileSync(pageUrl, 'utf8');

function expectSource(fragment, message) {
  assert.ok(source.includes(fragment), message);
}

expectSource('const UUID_PATTERN=', 'incident deep links must define UUID validation');
expectSource("if(!UUID_PATTERN.test(incidentId))", 'incident ids must be UUID validated before requests');
expectSource("url.searchParams.set('incident',incidentId)", 'opening an incident must persist its id in the URL');
expectSource("url.searchParams.set('workspace',workspaceId)", 'copied incident links must preserve the selected workspace');
expectSource("url.searchParams.delete('incident')", 'the incident deep link must be removable');
expectSource("requestedWorkspaceRef.current=UUID_PATTERN.test(requestedWorkspace)?requestedWorkspace:''", 'workspace deep links must accept only UUID-shaped workspace ids');
expectSource('const rows=payload.workspaces||[],requested=rows.find(item=>item.id===requestedWorkspaceRef.current)', 'workspace deep links must resolve only against authorized session memberships');
expectSource("setDeepLinkedIncidentId(UUID_PATTERN.test(incident)?incident:'')", 'refresh restoration must accept only valid incident ids');
expectSource('void openIncident(deepLinkedIncidentId,{persist:false})', 'a valid deep link must restore through the tenant-scoped incident detail flow');
expectSource('restoredIncidentRef.current===`${workspaceId}:${deepLinkedIncidentId}`', 'deep-link restoration must be idempotent per workspace');
expectSource("replaceDeepLink(id,'');setWorkspaceId(id)", 'switching companies must clear the previous tenant incident link');
expectSource("window.addEventListener('popstate',onPopState)", 'browser history navigation must restore incident deep-link state');
expectSource('/api/customer/workspaces/${workspaceId}/readiness-incidents/', 'deep links must resolve through the customer workspace proxy');
expectSource('navigator.clipboard?.writeText', 'copy link must prefer the modern Clipboard API');
expectSource("document.execCommand('copy')", 'copy link must provide a compatibility fallback');
expectSource('role="status" aria-live="polite"', 'copy feedback must be announced accessibly');
expectSource("copiedIncidentId===incident.id?'Copied':'Copy link'", 'copy actions must provide visible success feedback');
assert.ok(!source.includes('/api/v1/workspaces/'), 'the browser must never call the internal admin API directly');

console.log('readiness incident deep-link regression checks passed');