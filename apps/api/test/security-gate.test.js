import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  isForbiddenTrackedPath,
  scanRepository,
  scanText
} from '../../../scripts/security-gate.mjs';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function repository(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ops-security-gate-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'security@example.test');
  git(root, 'config', 'user.name', 'Security Test');
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  git(root, 'add', '.');
  return root;
}

test('detects production credential formats without returning secret values', () => {
  const token = `ghp_${'A'.repeat(36)}`;
  const findings = scanText(`const token = '${token}';`, 'src/config.js');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'github_token');
  assert.equal(findings[0].file, 'src/config.js');
  assert.equal(findings[0].line, 1);
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(token));
});

test('allows explicit placeholders and environment reads', () => {
  assert.deepEqual(scanText("const key = process.env.API_KEY || 'replace_me';", 'src/config.js'), []);
  assert.deepEqual(scanText("API_KEY='your_api_key_here'", '.env.example'), []);
});

test('blocks tracked environment and private key files but permits templates', () => {
  assert.equal(isForbiddenTrackedPath('.env'), true);
  assert.equal(isForbiddenTrackedPath('deploy/.env.production'), true);
  assert.equal(isForbiddenTrackedPath('.env.example'), false);
  assert.equal(isForbiddenTrackedPath('keys/id_ed25519'), true);
  assert.equal(isForbiddenTrackedPath('certs/production.pem'), true);
  assert.equal(isForbiddenTrackedPath('certs/example.pem'), false);
});

test('scans only tracked files and reports sanitized locations', async () => {
  const stripeLikeSecret = ['sk', 'live', '4Pm9qR7tV2nK8cL5sD1fH6jB3wX0zA'].join('_');
  const untrackedSecret = ['github', 'pat', '11AA22BB33CC44DD55EE66FF77GG88HH99JJ00KK11LL'].join('_');
  const root = await repository({
    'src/safe.js': "export const key = process.env.API_KEY;\n",
    'src/leaked.js': `export const key = '${stripeLikeSecret}';\n`,
    'untracked.txt': `${untrackedSecret}\n`
  });
  git(root, 'reset', '-q', 'untracked.txt');
  const result = await scanRepository(root);
  assert.equal(result.status, 'failed');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].file, 'src/leaked.js');
  assert.equal(result.findings[0].category, 'stripe_live_key');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(stripeLikeSecret));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(untrackedSecret));
});

test('passes a repository containing only safe tracked configuration', async () => {
  const root = await repository({
    '.env.example': 'API_KEY=replace_me\n',
    'src/config.js': "export const apiKey = process.env.API_KEY || '';\n"
  });
  const result = await scanRepository(root);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.findings, []);
});
