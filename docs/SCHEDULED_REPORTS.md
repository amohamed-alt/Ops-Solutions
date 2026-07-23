# Scheduled report orchestration

Ops Solutions can turn a user-owned saved reporting view into a recurring tenant-scoped report export.

## Supported schedules

- daily, weekly, or monthly cadence
- IANA timezone and local delivery time
- weekly weekday or monthly day 1–28
- CSV or XLSX export
- summary-only or attachment delivery intent
- up to 20 validated and deduplicated recipients
- pause, resume, update, and delete controls

## Runtime model

The API polls due schedules once per minute. Due rows are claimed with a PostgreSQL transaction and `FOR UPDATE SKIP LOCKED`, which allows more than one API replica without duplicate processing. Every scheduled occurrence has a unique `(schedule_id, scheduled_for)` execution record.

For each occurrence, the platform:

1. resolves the saved view's relative date preset at execution time;
2. creates a tenant- and user-scoped `report_export_jobs` row;
3. queues the existing BullMQ background export worker;
4. advances `next_run_at` using the schedule timezone;
5. records export and delivery lifecycle state.

The scheduler never trusts a browser-supplied workspace ID. Customer sessions and workspace roles are checked before every read or write. Only owners and admins can create, modify, pause, resume, or delete schedules. Viewers can monitor them.

## Delivery provider boundary

Email dispatch intentionally remains behind a provider boundary. No SMTP, Postmark, Resend, or other account has been selected or configured. The current production-safe behavior is:

- generate the requested export;
- persist execution history;
- mark the execution `ready_for_delivery` with `provider_not_configured`;
- retain the generated artifact under the existing 24-hour export policy.

A future provider adapter should accept a normalized message containing workspace, schedule, recipients, subject, summary, and an optional export artifact. Provider credentials must remain in the VPS environment and must never be stored in schedule rows or returned to the browser.

## Operational checks

Useful queries:

```sql
SELECT id, workspace_id, name, enabled, next_run_at, last_run_at, last_success_at, last_failure_at, last_error
FROM scheduled_report_schedules
ORDER BY next_run_at;
```

```sql
SELECT schedule_id, scheduled_for, status, delivery_status, export_job_id, error, created_at
FROM scheduled_report_executions
ORDER BY created_at DESC
LIMIT 100;
```

## Recovery

- A failed queue submission is recorded on both the execution and schedule.
- Unique execution keys prevent duplicate sends after a scheduler restart.
- Re-enabling or updating a schedule recomputes its next run from the current time.
- Generated exports keep the existing BullMQ retry and artifact expiration behavior.

## Migration and rollback

Schema migration version 5 creates:

- `scheduled_report_schedules`
- `scheduled_report_executions`

Rollback order:

```sql
DROP TABLE IF EXISTS scheduled_report_executions;
DROP TABLE IF EXISTS scheduled_report_schedules;
```

Rollback removes schedule configuration and execution history only. It does not modify CRM data, HubSpot connections, saved views, or previously generated export jobs.
