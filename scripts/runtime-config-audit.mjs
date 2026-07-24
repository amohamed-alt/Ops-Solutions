#!/usr/bin/env node

import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const EXIT = Object.freeze({ healthy: 0, warning: 2, critical: 3, failure: 4 });
const PLACEHOLDER_PATTERNS = [
  /^change[-_ ]?me$/i,
  /^replace[-_ ]?me$/i,
  /^your[-_ ].+/i,
  /^example$/i,
  /^test$/i,
  /^password$/i,
  /^secret$/i,
  /^changeme/i,
  /placeholder/i
];
const BOOLEAN_KEYS = new Set(['DEMO_MODE', 'DISABLE_AUTH', 'NEXT_TELEMETRY_DISABLED']);
const URL_KEYS = new Set(['APP_URL', 'API_INTERNAL_URL', 'DATABASE_URL', 'REDIS_URL', 'HUBSPOT_REDIRECT_URI']);
const SENSITIVE_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|PRIVATE|ENCRYPTION|API_KEY|SSH_KEY)/i;
const PRODUCTION_DANGEROUS = new Map([
  ['DEMO_MODE', 'true'],
  ['DISABLE_AUTH', 'true'],
  ['NODE_ENV', 'development']
]);

function parseArgs(argv) {
  const options = {
    envFile: '.env',
    templateFile: '.env.example',
    composeFiles: ['docker-compose.yml', 'docker-compose.prod.yml'],
    format: 'text',
    production: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env-file') options.envFile = argv[++index];
    else if (arg === '--template-file') options.templateFile = argv[++index];
    else if (arg === '--compose-file') options.composeFiles.push(argv[++index]);
    else if (arg === '--format') options.format = argv[++index];
    else if (arg === '--no-production-policy') options.production = false;
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['text', 'json'].includes(options.format)) throw new Error('Format must be text or json.');
  options.composeFiles = [...new Set(options.composeFiles.filter(Boolean))];
  return options;
}

function parseEnv(content) {
  const values = new Map();
  const duplicates = [];
  const invalidLines = [];
  const lines = String(content).split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const normalized = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(normalized);
    if (!match) {
      invalidLines.push(index + 1);
      return;
    }
    const key = match[1];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (values.has(key)) duplicates.push(key);
    values.set(key, value);
  });
  return { values, duplicates: [...new Set(duplicates)], invalidLines };
}

function composeVariables(contents) {
  const keys = new Set();
  for (const content of contents) {
    for (const match of String(content).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::[-?][^}]*)?\}/g)) keys.add(match[1]);
  }
  return keys;
}

function isPlaceholder(value) {
  const normalized = String(value ?? '').trim();
  return !normalized || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function validateUrl(key, value) {
  try {
    const url = new URL(value);
    if (key === 'APP_URL' || key === 'HUBSPOT_REDIRECT_URI') return url.protocol === 'https:';
    if (key === 'DATABASE_URL') return ['postgres:', 'postgresql:'].includes(url.protocol);
    if (key === 'REDIS_URL') return ['redis:', 'rediss:'].includes(url.protocol);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function addFinding(findings, severity, code, key, message) {
  findings.push({ severity, code, key: key || null, message });
}

export function evaluateRuntimeConfig({ env, template, composeKeys, mode = 0o600, production = true }) {
  const findings = [];
  const requiredKeys = new Set([...template.values.keys(), ...composeKeys]);

  for (const key of requiredKeys) {
    if (!env.values.has(key)) addFinding(findings, 'critical', 'missing_required_key', key, 'Required configuration key is missing.');
  }
  for (const key of env.duplicates) addFinding(findings, 'critical', 'duplicate_key', key, 'Configuration key is declared more than once.');
  for (const line of env.invalidLines) addFinding(findings, 'warning', 'invalid_env_line', null, `Unparseable environment line ${line}.`);

  const permissionBits = mode & 0o777;
  if ((permissionBits & 0o077) !== 0) {
    addFinding(findings, 'critical', 'unsafe_env_permissions', null, `Environment file permissions are ${permissionBits.toString(8)}; expected 600 or stricter.`);
  }

  for (const [key, value] of env.values) {
    if (requiredKeys.has(key) && isPlaceholder(value)) {
      addFinding(findings, 'critical', 'placeholder_value', key, 'Required configuration still uses an empty or placeholder value.');
    }
    if (BOOLEAN_KEYS.has(key) && value && !['true', 'false'].includes(value.toLowerCase())) {
      addFinding(findings, 'critical', 'invalid_boolean', key, 'Boolean configuration must be true or false.');
    }
    if (URL_KEYS.has(key) && value && !validateUrl(key, value)) {
      addFinding(findings, 'critical', 'invalid_url', key, 'URL configuration has an invalid or unsafe scheme.');
    }
    if (SENSITIVE_KEY_PATTERN.test(key) && value && value.length < 24 && !isPlaceholder(value)) {
      addFinding(findings, 'warning', 'short_sensitive_value', key, 'Sensitive configuration is shorter than the recommended minimum length.');
    }
    if (production && PRODUCTION_DANGEROUS.get(key) === value.toLowerCase()) {
      addFinding(findings, 'critical', 'unsafe_production_flag', key, 'Configuration value is unsafe for production.');
    }
  }

  const unknown = [...env.values.keys()].filter((key) => !requiredKeys.has(key));
  for (const key of unknown) addFinding(findings, 'warning', 'undocumented_key', key, 'Configuration key is not documented in the template or referenced by Compose.');

  const severityRank = { healthy: 0, warning: 1, critical: 2 };
  const status = findings.reduce((current, finding) => severityRank[finding.severity] > severityRank[current] ? finding.severity : current, 'healthy');
  return {
    status,
    summary: {
      requiredKeys: requiredKeys.size,
      configuredKeys: env.values.size,
      critical: findings.filter((item) => item.severity === 'critical').length,
      warning: findings.filter((item) => item.severity === 'warning').length
    },
    findings
  };
}

async function readExisting(filePath, required = true) {
  try {
    await access(filePath);
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (!required && error.code === 'ENOENT') return '';
    throw error;
  }
}

function textOutput(result, files) {
  const lines = [
    `Runtime configuration: ${result.status.toUpperCase()}`,
    `Environment: ${files.envFile}`,
    `Required keys: ${result.summary.requiredKeys}`,
    `Configured keys: ${result.summary.configuredKeys}`,
    `Critical: ${result.summary.critical}`,
    `Warnings: ${result.summary.warning}`
  ];
  for (const finding of result.findings) {
    lines.push(`${finding.severity.toUpperCase()} ${finding.code}${finding.key ? ` [${finding.key}]` : ''}: ${finding.message}`);
  }
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: runtime-config-audit.mjs [--env-file PATH] [--template-file PATH] [--compose-file PATH] [--format text|json] [--no-production-policy]');
      return;
    }
    const root = process.cwd();
    const envPath = path.resolve(root, options.envFile);
    const templatePath = path.resolve(root, options.templateFile);
    const [envContent, templateContent, envStat] = await Promise.all([
      readExisting(envPath),
      readExisting(templatePath),
      stat(envPath)
    ]);
    const composeContents = await Promise.all(options.composeFiles.map((file) => readExisting(path.resolve(root, file), false)));
    const result = evaluateRuntimeConfig({
      env: parseEnv(envContent),
      template: parseEnv(templateContent),
      composeKeys: composeVariables(composeContents),
      mode: envStat.mode,
      production: options.production
    });
    const payload = { checkedAt: new Date().toISOString(), files: { envFile: options.envFile, templateFile: options.templateFile, composeFiles: options.composeFiles }, ...result };
    console.log(options.format === 'json' ? JSON.stringify(payload) : textOutput(result, payload.files));
    process.exitCode = EXIT[result.status];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Configuration audit failed.';
    console.error(options?.format === 'json' ? JSON.stringify({ status: 'failure', message }) : `Runtime configuration audit failed: ${message}`);
    process.exitCode = EXIT.failure;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
