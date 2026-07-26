#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 2_000;

const TRANSIENT_PATTERNS = [
  /audit endpoint returned an error/i,
  /invalid json response body/i,
  /unexpected token.*not valid json/i,
  /eai_again/i,
  /econnreset/i,
  /etimedout/i,
  /socket hang up/i,
  /network timeout/i,
  /status code 429/i,
  /status code 5\d\d/i,
  /http 429/i,
  /http 5\d\d/i,
];

export function isTransientAuditFailure(output) {
  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(output));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runAudit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['audit', ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({
      code: code ?? 1,
      signal,
      output: `${stdout}\n${stderr}`,
    }));
  });
}

export async function runAuditWithRetry({
  args = ['--omit=dev', '--audit-level=critical'],
  attempts = positiveInteger(process.env.NPM_AUDIT_ATTEMPTS, DEFAULT_ATTEMPTS),
  baseDelayMs = positiveInteger(process.env.NPM_AUDIT_BASE_DELAY_MS, DEFAULT_BASE_DELAY_MS),
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await runAudit(args);
    if (result.code === 0) return result;

    const transient = isTransientAuditFailure(result.output);
    if (!transient || attempt === attempts) return result;

    const delayMs = baseDelayMs * attempt;
    process.stderr.write(`npm audit transport failure detected; retrying attempt ${attempt + 1}/${attempts} in ${delayMs}ms.\n`);
    await sleep(delayMs);
  }

  return { code: 1, signal: null, output: 'npm audit retry loop exhausted unexpectedly.' };
}

async function main() {
  const args = process.argv.slice(2);
  const result = await runAuditWithRetry({ args: args.length ? args : undefined });
  if (result.signal) process.stderr.write(`npm audit terminated by signal ${result.signal}.\n`);
  process.exitCode = result.code;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`npm audit wrapper failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
