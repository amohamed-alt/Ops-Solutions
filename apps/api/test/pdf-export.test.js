import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildRevenuePdf } from '../src/pdf-export.js';

const SAMPLE = `Ops Solutions Revenue Intelligence Export\r\nWorkspace,Example Workspace\r\nGenerated at,2026-07-24\r\n\r\nExecutive overview\r\nMetric,Value\r\nOpen pipeline,125000\r\nWon revenue,45000\r\n\r\nAction queue\r\nSignal,Count\r\nOverdue tasks,12\r\n`;

test('generates a valid bounded PDF without external rendering dependencies', () => {
  const artifact = buildRevenuePdf(SAMPLE);
  assert.ok(Buffer.isBuffer(artifact));
  assert.equal(artifact.subarray(0, 8).toString('binary'), '%PDF-1.4');
  assert.match(artifact.toString('binary'), /\/Type \/Catalog/);
  assert.match(artifact.toString('binary'), /Executive overview/);
  assert.match(artifact.toString('binary'), /xref/);
  assert.match(artifact.toString('binary'), /%%EOF/);
  assert.ok(artifact.byteLength < 5 * 1024 * 1024);
});

test('dashboard export proxy supports filtered CSV and PDF artifacts', async () => {
  const [api, proxy, action] = await Promise.all([
    readFile(new URL('../src/report-exports.js', import.meta.url), 'utf8'),
    readFile(new URL('../../web/app/api/dashboard/[workspaceId]/export/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../web/components/sdr/PdfSnapshotAction.tsx', import.meta.url), 'utf8')
  ]);
  assert.match(api, /exports\/revenue\.pdf/);
  assert.match(api, /assertBillingQuota/);
  assert.match(api, /recordBillingUsage/);
  assert.match(proxy, /format === 'pdf'/);
  assert.match(proxy, /customerHeaders/);
  assert.match(action, /searchParams\.get\('scope'\) !== 'operating'/);
  assert.match(action, /query\.set\('format', 'pdf'\)/);
  assert.doesNotMatch(`${api}\n${proxy}\n${action}`, /ADMIN_API_KEY|x-admin-key|client[_-]?secret|access[_-]?token/i);
});
