import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../src/sync.js', import.meta.url), 'utf8');

test('association upsert names the composite conflict target', () => {
  assert.match(
    source,
    /ON CONFLICT \(\s*workspace_id,\s*from_object_type,\s*from_record_id,\s*to_object_type,\s*to_record_id,\s*association_type\s*\) DO UPDATE SET synced_at = NOW\(\)/m
  );
});

test('worker sync SQL does not contain an unqualified update conflict clause', () => {
  assert.doesNotMatch(source, /ON CONFLICT\s+DO UPDATE/m);
});
