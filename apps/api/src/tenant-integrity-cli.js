import { postgres } from './database.js';
import { runTenantIntegrityAudit, tenantAuditExitCode } from './tenant-integrity.js';

function parseArguments(argv) {
  const options = { format: 'text' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--workspace') {
      options.workspaceId = value;
      index += 1;
    } else if (argument === '--limit') {
      options.limit = value;
      index += 1;
    } else if (argument === '--stale-hours') {
      options.staleHours = value;
      index += 1;
    } else if (argument === '--format') {
      options.format = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!['text', 'json'].includes(options.format)) throw new Error('Format must be text or json.');
  if (options.workspaceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.workspaceId)) {
    throw new Error('Workspace must be a valid UUID.');
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Ops Solutions tenant integrity audit\n\nUsage:\n  node src/tenant-integrity-cli.js [options]\n\nOptions:\n  --workspace <uuid>    Audit one workspace instead of the full fleet\n  --limit <1-500>       Maximum samples returned per check (default 100)\n  --stale-hours <1-720> Threshold for stuck sync/webhook work (default 24)\n  --format text|json    Output format (default text)\n  --help                Show this help\n`);
}

function printText(report) {
  process.stdout.write(`Tenant integrity: ${report.status.toUpperCase()}\n`);
  process.stdout.write(`Scope: ${report.scope.workspaceId || 'all workspaces'}\n`);
  process.stdout.write(`Checks: ${report.summary.checks}; critical: ${report.summary.critical}; warnings: ${report.summary.warning}\n\n`);
  for (const result of report.results) {
    const marker = result.status === 'passed' ? 'PASS' : result.status === 'not_applicable' ? 'N/A ' : 'FAIL';
    process.stdout.write(`[${marker}] ${result.key} (${result.severity}) — ${result.description}\n`);
    if (result.count) process.stdout.write(`       ${result.count}${result.truncated ? '+' : ''} issue(s) found\n`);
    if (result.error) process.stdout.write(`       ${result.error}\n`);
  }
}

let exitCode = 4;
try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    exitCode = 0;
  } else {
    const report = await runTenantIntegrityAudit(postgres, options);
    if (options.format === 'json') process.stdout.write(`${JSON.stringify(report)}\n`);
    else printText(report);
    exitCode = tenantAuditExitCode(report);
  }
} catch (error) {
  process.stderr.write(`Tenant integrity audit failed: ${String(error?.message ?? error)}\n`);
  exitCode = 4;
} finally {
  await postgres.end().catch(() => undefined);
  process.exitCode = exitCode;
}
