#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const SAFE_ENV_FILES = new Set(['.env.example', '.env.sample', '.env.template']);
const SKIP_DIRECTORIES = new Set(['.git', '.next', 'node_modules', 'coverage', 'dist', 'build']);
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.woff', '.woff2', '.ttf', '.eot']);
const SELF_PATH = 'scripts/security-gate.mjs';

const SECRET_PATTERNS = Object.freeze([
  { id: 'private_key', label: 'Private key material', regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { id: 'github_token', label: 'GitHub access token', regex: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/g },
  { id: 'github_fine_grained_token', label: 'GitHub fine-grained token', regex: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { id: 'aws_access_key', label: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'slack_token', label: 'Slack token', regex: /\bxox(?:a|b|p|r|s)-[A-Za-z0-9-]{20,}\b/g },
  { id: 'stripe_live_key', label: 'Stripe live secret key', regex: /\bsk_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'hubspot_private_app_token', label: 'HubSpot private app token', regex: /\bpat-(?:eu1|na1|ap1)-[a-f0-9-]{20,}\b/gi },
  { id: 'google_api_key', label: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    id: 'credential_assignment',
    label: 'Hard-coded credential assignment',
    regex: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["']([^"'\s]{24,})["']/gi
  }
]);

const PLACEHOLDER_MARKERS = /(?:example|placeholder|replace[_-]?me|your[_-]|dummy|fake|test[_-]?only|redacted|xxxx|\*\*\*)/i;

function normalizePath(value) {
  return String(value).split(sep).join('/').replace(/^\.\//, '');
}

export function isForbiddenTrackedPath(filePath) {
  const normalized = normalizePath(filePath);
  const baseName = normalized.split('/').at(-1) || '';
  if (baseName === '.env' || (baseName.startsWith('.env.') && !SAFE_ENV_FILES.has(baseName))) return true;
  if (/^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/i.test(baseName)) return true;
  if (/\.(?:pem|p12|pfx|jks|keystore)$/i.test(baseName) && !/(?:example|sample|test)/i.test(normalized)) return true;
  return false;
}

function shouldSkipPath(filePath) {
  const normalized = normalizePath(filePath);
  if (normalized === SELF_PATH) return true;
  if (normalized.split('/').some((part) => SKIP_DIRECTORIES.has(part))) return true;
  return BINARY_EXTENSIONS.has(extname(normalized).toLowerCase());
}

function safeLine(line) {
  return PLACEHOLDER_MARKERS.test(line) || /process\.env\.|env\[["']|getenv\(/i.test(line);
}

export function scanText(content, filePath = 'unknown') {
  const findings = [];
  const lines = String(content).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (safeLine(line)) continue;
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0;
      if (!pattern.regex.test(line)) continue;
      findings.push({
        severity: 'critical',
        category: pattern.id,
        message: pattern.label,
        file: normalizePath(filePath),
        line: index + 1
      });
    }
  }
  return findings;
}

function trackedFiles(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to enumerate tracked repository files.');
  }
  return result.stdout.split('\0').filter(Boolean);
}

export async function scanRepository(root = process.cwd()) {
  const absoluteRoot = resolve(root);
  const findings = [];
  const files = trackedFiles(absoluteRoot);

  for (const trackedPath of files) {
    const normalized = normalizePath(trackedPath);
    if (isForbiddenTrackedPath(normalized)) {
      findings.push({
        severity: 'critical',
        category: 'forbidden_sensitive_file',
        message: 'Sensitive credential or key file must not be tracked.',
        file: normalized,
        line: null
      });
      continue;
    }
    if (shouldSkipPath(normalized)) continue;

    const absolutePath = resolve(absoluteRoot, normalized);
    const metadata = await stat(absolutePath).catch(() => null);
    if (!metadata?.isFile() || metadata.size > MAX_FILE_BYTES) continue;
    const content = await readFile(absolutePath, 'utf8').catch(() => null);
    if (content === null || content.includes('\u0000')) continue;
    findings.push(...scanText(content, normalized));
  }

  return {
    status: findings.length === 0 ? 'passed' : 'failed',
    scannedFiles: files.length,
    findings
  };
}

function parseArguments(argv) {
  const options = { root: process.cwd(), format: 'text' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root') options.root = argv[++index];
    else if (argv[index] === '--format') options.format = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.root) throw new Error('--root requires a value.');
  if (!['text', 'json'].includes(options.format)) throw new Error('--format must be text or json.');
  return options;
}

function printText(result) {
  console.log(`Security gate: ${result.status.toUpperCase()}`);
  console.log(`Tracked files inspected: ${result.scannedFiles}`);
  if (result.findings.length === 0) return;
  for (const finding of result.findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.log(`- [${finding.category}] ${location} — ${finding.message}`);
  }
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = await scanRepository(options.root);
    if (options.format === 'json') console.log(JSON.stringify(result));
    else printText(result);
    process.exitCode = result.status === 'passed' ? 0 : 2;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Security gate configuration error: ${message}`);
    process.exitCode = 4;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
