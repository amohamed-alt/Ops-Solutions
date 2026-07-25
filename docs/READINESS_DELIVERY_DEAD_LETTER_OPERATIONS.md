# Readiness Delivery Dead-letter Operations

Readiness regression and recovery emails use a durable PostgreSQL delivery queue. A delivery becomes operationally exhausted when it remains `failed` after five attempts. Exhausted deliveries are no longer claimed by the normal notification worker, so they require explicit review before retrying.

This runbook adds safe fleet and tenant-scoped visibility plus a dry-run-first requeue operation.

## Inspect fleet status

```bash
bash scripts/readiness-delivery-dead-letter.sh \
  --action status \
  --limit 100
```

The output includes only bounded operational metadata:

- delivery, incident, snapshot and workspace identifiers
- workspace display name
- notification kind
- attempt count
- timestamps
- a shortened error message

It does not include recipients, credentials, OAuth tokens, CRM payloads, session data or email bodies.

## Inspect one workspace

```bash
bash scripts/readiness-delivery-dead-letter.sh \
  --action status \
  --workspace <workspace-uuid> \
  --limit 100
```

All workspace filters are parameterized and validated as UUIDs before SQL execution.

## Preview a requeue

Requeue is dry-run by default and requires both the workspace and delivery identifiers:

```bash
bash scripts/readiness-delivery-dead-letter.sh \
  --action requeue \
  --workspace <workspace-uuid> \
  --delivery <delivery-uuid>
```

The operation locks the exact row and verifies that it is still `failed` with at least five attempts. No data is changed during preview.

## Apply a reviewed requeue

After confirming that the provider configuration, recipient membership and underlying incident are valid:

```bash
bash scripts/readiness-delivery-dead-letter.sh \
  --action requeue \
  --workspace <workspace-uuid> \
  --delivery <delivery-uuid> \
  --apply
```

The update is transactionally scoped to `delivery_id + workspace_id`, resets attempts to zero, clears stale claim/provider metadata and returns the delivery to `pending`. The normal scheduled worker will then process it using the existing provider idempotency key.

## Safety properties

- No bulk requeue action is provided.
- Requeue requires an exact workspace and delivery UUID.
- Preview is the default; mutation requires `--apply`.
- Non-exhausted or already delivered records cannot be requeued.
- Row locking prevents concurrent review and mutation races.
- Existing queue uniqueness and email provider idempotency remain unchanged.
- The command does not alter incidents, readiness snapshots or workspace memberships.

## Recommended incident procedure

1. Inspect dead-letter status for the affected workspace.
2. Confirm Resend or Postmark configuration is healthy.
3. Confirm the workspace still has an active owner or admin recipient.
4. Review the shortened error reason and the readiness incident state.
5. Run the dry-run requeue command.
6. Apply only the exact reviewed delivery.
7. Verify the next scheduled notification cycle and unified monitoring status.

## Rollback

The feature is additive. To stop using it, do not invoke the script. Removing the module, wrapper and this runbook does not modify queue data or the normal notification worker.
