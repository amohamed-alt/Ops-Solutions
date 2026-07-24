# Fleet session cap enforcement

Ops Solutions can audit and enforce a maximum number of active customer sessions per account without exposing session tokens.

## Inspect current risk

```bash
bash scripts/session-security.sh \
  --action status \
  --max-active 10 \
  --stale-days 45 \
  --format json
```

The status report contains aggregate counts and user-level totals only. It never returns token hashes, cookies, passwords, HubSpot credentials, or CRM payloads.

## Preview fleet enforcement

Always run a dry-run first:

```bash
bash scripts/session-security.sh \
  --action enforce-all-caps \
  --max-active 10 \
  --limit 500 \
  --dry-run \
  --format json
```

The preview returns the number of candidate sessions and affected users. No records are deleted.

## Apply a bounded batch

```bash
bash scripts/session-security.sh \
  --action enforce-all-caps \
  --max-active 10 \
  --limit 500 \
  --apply \
  --format json
```

The operation keeps the most recently active sessions per user and removes only ranked overflow sessions. Ordering uses `last_seen_at`, `created_at`, and `token_hash` as a deterministic tie-breaker.

## Production safety

- Only active, non-expired sessions belonging to active users are considered.
- The apply query is bounded to at most `--limit` deletions per run.
- A PostgreSQL advisory transaction lock prevents concurrent fleet enforcement runs from racing across API replicas or operators.
- Deletion joins on both `user_id` and the exact selected token hash.
- Dry-run is explicit and returns aggregate data only.
- The command does not change passwords, memberships, HubSpot connections, CRM data, or workspace records.

## Recommended operating policy

1. Run the status report daily.
2. Alert when any account exceeds the selected cap.
3. Run dry-run and retain the JSON result in the incident record.
4. Apply a bounded batch during a low-traffic window.
5. Run status again and confirm that the number of users above cap decreased.

For interactive customer self-service, users can continue managing their own sessions from `/settings/security`.
