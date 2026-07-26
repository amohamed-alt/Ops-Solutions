const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'app', 'settings', 'readiness', 'page.tsx');
const source = fs.readFileSync(pagePath, 'utf8');

assert.match(source, /const UUID_PATTERN=\/\^\[0-9a-f\]\{8\}/, 'incident deep links must be UUID validated before requests');
assert.match(source, /url\.searchParams\.set\('incident',incidentId\)/, 'opening an incident must persist its id in the URL');
assert.match(source, /url\.searchParams\.delete\('incident'\)/, 'the incident deep link must be removable');
assert.match(source, /setDeepLinkedIncidentId\(UUID_PATTERN\.test\(incident\)\?incident:''\)/, 'refresh restoration must accept only valid incident ids');
assert.match(source, /void openIncident\(deepLinkedIncidentId,\{persist:false\}\)/, 'a valid deep link must restore through the tenant-scoped incident detail flow');
assert.match(source, /restoredIncidentRef\.current===`\$\{workspaceId\}:\$\{deepLinkedIncidentId\}`/, 'deep-link restoration must be idempotent per workspace');
assert.match(source, /const selectWorkspace=useCallback\([^]*setIncidentDeepLink\(''\)[^]*setWorkspaceId\(id\)/, 'switching companies must clear the previous tenant incident link');
assert.match(source, /window\.addEventListener\('popstate',onPopState\)/, 'browser history navigation must restore incident deep-link state');
assert.match(source, /\/api\/customer\/workspaces\/\$\{workspaceId\}\/readiness-incidents\//, 'deep links must resolve through the customer workspace proxy');
assert.doesNotMatch(source, /\/api\/v1\/workspaces\//, 'the browser must never call the internal admin API directly');

console.log('readiness incident deep-link regression checks passed');
