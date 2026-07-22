import assert from 'node:assert/strict';
import test from 'node:test';

import { strFromU8, unzipSync } from 'fflate';

import { buildRevenueXlsx } from '../src/xlsx-export.js';

test('builds a valid styled XLSX package from the protected CSV representation', () => {
  const csv = [
    '\uFEFFOps Solutions Revenue Intelligence Export',
    'Workspace,Acme & Partners',
    'Generated at,2026-07-22T12:00:00.000Z',
    'Data freshness,2026-07-22T11:00:00.000Z',
    'Reporting period,2026-07-01 to 2026-07-22',
    'Saved view,Leadership',
    'Owner filter,All owners',
    'Country filter,UAE',
    'Lead source filter,All sources',
    'Pipeline filter,All pipelines',
    'Stage filter,All stages',
    '',
    'Executive overview',
    'Metric,Value',
    'Won Revenue,12000',
    'Action queue',
    'Signal,Count',
    '"=unsafe formula",2'
  ].join('\r\n');

  const artifact = buildRevenueXlsx(csv, '2026-07-22T12:00:00.000Z');
  assert.equal(artifact.subarray(0, 2).toString(), 'PK');
  const files = unzipSync(artifact);
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['xl/workbook.xml']);
  assert.ok(files['xl/styles.xml']);
  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /name="Executive Report"|<sheetData>/);
  assert.match(sheet, /Acme &amp; Partners/);
  assert.match(sheet, /&quot;|=unsafe formula/);
  assert.doesNotMatch(sheet, /<f>/);
  assert.match(sheet, /mergeCell ref="A13:B13"/);
});
