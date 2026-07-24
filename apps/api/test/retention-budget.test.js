import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseRetentionCsv,
  validateRetentionRows
} from '../src/retention-budget.js';

const CSV = `Company Name,Domain,Product,Month,Renewal,Booked,Cash,RM,Expected Lost,Status\nExample Co,example.com,ATS,2026-08,10000,2000,1500,Alex,false,Active\nExample Co,example.com,ATS,2026-08,2500,500,500,Alex,false,Active\nLost Co,lost.example,Onboarding,2026-05,8000,0,0,Sam,true,Active\nInvalid Co,invalid.example,,bad-month,not-money,0,0,Sam,false,Active\n`;

const mapping = {
  companyName: 'Company Name',
  companyDomain: 'Domain',
  product: 'Product',
  budgetMonth: 'Month',
  renewalValue: 'Renewal',
  bookedValue: 'Booked',
  cashCollected: 'Cash',
  rmCsm: 'RM',
  expectedLost: 'Expected Lost',
  accountStatus: 'Status',
  notes: null
};

test('validates, normalizes and consolidates company plus product budget duplicates', () => {
  const parsed = parseRetentionCsv(CSV);
  const result = validateRetentionRows(parsed.rows, mapping, { currency: 'USD' });
  assert.equal(result.totalRows, 4);
  assert.equal(result.validRowCount, 2);
  assert.equal(result.rejectedRowCount, 1);
  assert.equal(result.duplicateRowCount, 1);
  const example = result.validRows.find((row) => row.companyDomain === 'example.com');
  assert.equal(example.renewalValue, 12500);
  assert.equal(example.bookedValue, 2500);
  assert.equal(example.cashCollected, 2000);
  assert.equal(example.duplicateCount, 2);
  assert.equal(example.budgetMonth, '2026-08-01');
  const lost = result.validRows.find((row) => row.companyDomain === 'lost.example');
  assert.equal(lost.expectedLost, true);
});

test('retention import and reporting SQL stays tenant scoped and deterministic', async () => {
  const source = await readFile(new URL('../src/retention-budget.js', import.meta.url), 'utf8');
  assert.match(source, /MAX_CSV_BYTES = 8 \* 1024 \* 1024/);
  assert.match(source, /MAX_ROWS = 20_000/);
  assert.match(source, /UNIQUE\(import_id, company_key, product_key, budget_month\)/);
  assert.match(source, /c\.workspace_id=b\.workspace_id/);
  assert.match(source, /property_mappings/);
  assert.match(source, /semantic_key='product'/);
  assert.match(source, /expected_lost=TRUE/);
  assert.match(source, /renewed_late/);
  assert.match(source, /notInBudget/);
  assert.doesNotMatch(source, /ADMIN_API_KEY|x-admin-key|client[_-]?secret|access[_-]?token/i);
});

test('retention categories and amount fields cannot be injected through CSV values', () => {
  const parsed = parseRetentionCsv(`Company,Product,Month,Value\nAcme,ATS,2026-09,"=IMPORTXML('bad')"\n`);
  assert.throws(() => validateRetentionRows(parsed.rows, {
    companyName: 'Company', companyDomain: null, product: 'Product', budgetMonth: 'Month',
    renewalValue: 'Value', bookedValue: null, cashCollected: null, rmCsm: null,
    expectedLost: null, accountStatus: null, notes: null
  }), /valid amount|No valid/i);
});
