import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/discovery.js', import.meta.url), 'utf8');

test('portal discovery includes HubSpot activity object schemas', () => {
  assert.match(
    source,
    /const ACTIVITY_OBJECT_TYPES = \['calls', 'meetings', 'tasks'\]/
  );

  assert.match(
    source,
    /for \(const objectType of ACTIVITY_OBJECT_TYPES\) \{\s*properties\.push\(\.\.\.await fetchOptionalActivityProperties/m
  );
});

test('activity schema authorization gaps are non-fatal', () => {
  assert.match(source, /\[401, 403, 404\]\.includes\(error\.statusCode\)/);
  assert.match(source, /return \[\];/);
});

test('core CRM object schema discovery remains mandatory', () => {
  assert.match(
    source,
    /const CORE_OBJECT_TYPES = \['contacts', 'companies', 'deals'\]/
  );
  assert.match(
    source,
    /for \(const objectType of CORE_OBJECT_TYPES\) \{\s*properties\.push\(\.\.\.await fetchProperties/m
  );
});
