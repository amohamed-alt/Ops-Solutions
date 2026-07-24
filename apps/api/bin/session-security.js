#!/usr/bin/env node
import { postgres } from '../src/database.js';
import {
  enforceAllSessionCaps,
  enforceSessionCap,
  inspectSessionSecurity,
  pruneExpiredSessions,
  revokeUserSessions
} from '../src/session-security.js';

function parseArgs(argv) {
  const options = { action: 'status', dryRun: false, format: 'text' };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--dry-run') options.dryRun = true;
    else if (item === '--apply') options.dryRun = false;
    else if (item === '--action') options.action = argv[++index];
    else if (item === '--user') options.userId = argv[++index];
    else if (item === '--max-active') options.maxActiveSessions = argv[++index];
    else if (item === '--stale-days') options.staleDays = argv[++index];
    else if (item === '--limit') options.limit = argv[++index];
    else if (item === '--format') options.format = argv[++index];
    else throw new Error(`Unknown argument: ${item}`);
  }
  return options;
}

function printText(result) {
  if (result.summary) {
    console.log(`Total sessions: ${result.summary.total_sessions ?? 0}`);
    console.log(`Active sessions: ${result.summary.active_sessions ?? 0}`);
    console.log(`Expired sessions: ${result.summary.expired_sessions ?? 0}`);
    console.log(`Stale active sessions: ${result.summary.stale_sessions ?? 0}`);
    console.log(`Users above cap: ${result.riskyUsers.length}`);
    for (const row of result.riskyUsers) console.log(`- ${row.email}: ${row.active_session_count} active sessions`);
    return;
  }
  if ('cap' in result) {
    console.log(`Dry run: ${result.dryRun}`);
    console.log(`Session cap: ${result.cap}`);
    console.log(`Affected users: ${result.affectedUsers ?? 0}`);
    console.log(`Candidate sessions: ${result.candidateSessions ?? result.revoked ?? 0}`);
    console.log(`Revoked sessions: ${result.revoked ?? 0}`);
    return;
  }
  console.log(JSON.stringify(result));
}

const options = parseArgs(process.argv.slice(2));
try {
  let result;
  if (options.action === 'status') result = await inspectSessionSecurity(postgres, options);
  else if (options.action === 'prune-expired') result = await pruneExpiredSessions(postgres, { dryRun: options.dryRun });
  else if (options.action === 'revoke-user') result = await revokeUserSessions(postgres, options.userId, { dryRun: options.dryRun });
  else if (options.action === 'enforce-cap') result = await enforceSessionCap(postgres, options.userId, options.maxActiveSessions, { dryRun: options.dryRun });
  else if (options.action === 'enforce-all-caps') result = await enforceAllSessionCaps(postgres, options);
  else throw new Error('Action must be status, prune-expired, revoke-user, enforce-cap, or enforce-all-caps.');
  if (options.format === 'json') console.log(JSON.stringify(result));
  else printText(result);
} catch (error) {
  console.error(error.message);
  process.exitCode = 4;
} finally {
  await postgres.end();
}
