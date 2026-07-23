# Customer session security operations

This runbook provides tenant-safe operational controls for customer login sessions without exposing session tokens or credentials.

## Read-only audit

```bash
bash scripts/session-security.sh --action status --format text
```

Policy overrides:

```bash
bash scripts/session-security.sh \
  --action status \
  --max-active 10 \
  --stale-days 45 \
  --limit 100 \
  --format json
```

The audit reports aggregate counts, users above the active-session policy, and users with stale sessions. It never prints token hashes, password hashes, cookies, OAuth tokens, CRM payloads, or database credentials.

## Prune expired sessions

Always review first:

```bash
bash scripts/session-security.sh --action prune-expired --dry-run --format json
```

Then execute:

```bash
bash scripts/session-security.sh --action prune-expired --format json
```

Only sessions whose `expires_at` is in the past are deleted.

## Revoke one user's sessions

```bash
bash scripts/session-security.sh \
  --action revoke-user \
  --user <user-uuid> \
  --dry-run \
  --format json
```

Remove the `--dry-run` flag after reviewing the candidate count. The query is scoped to the supplied user UUID.

## Enforce an active-session cap

```bash
bash scripts/session-security.sh \
  --action enforce-cap \
  --user <user-uuid> \
  --max-active 5 \
  --dry-run \
  --format json
```

Execution keeps the most recently active sessions and revokes only the overflow sessions for that user.

## Recommended schedule

Run the read-only audit daily and prune expired sessions weekly. Do not automate user-specific revocation without an approved incident or security policy. Password reset completion should revoke all existing sessions separately when the production reset flow is introduced.

## Safety properties

- Destructive actions are dry-run by default at the library boundary.
- User-specific changes require a validated UUID.
- Session-cap deletion uses only hashes returned by a user-scoped selection.
- Output contains aggregate metadata and account identity only.
- No schema migration, new secret, dependency, or public endpoint is required.
