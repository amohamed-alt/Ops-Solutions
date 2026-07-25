# Customer readiness dead-letter inbox

## Purpose

The onboarding readiness center exposes exhausted readiness-notification deliveries to authorized workspace users. Owners and admins can validate one delivery and then explicitly schedule one retry. Viewers have read-only visibility.

## User flow

1. Open `/settings/readiness` and select a company workspace.
2. Review the **Failed readiness notifications** section.
3. Select **Validate retry**. This performs the server-side dry run and does not mutate the delivery.
4. After validation succeeds, select **Schedule one retry**. The delivery returns to the durable queue and is processed by the scheduled notification worker.

The confirmation state resets whenever the workspace is refreshed or changed, so an old validation cannot be reused after the underlying list changes.

## Security and tenancy

- Every browser request passes through a same-origin Next.js proxy.
- The proxy validates customer membership before calling the internal API.
- Retry mutations require the `owner` or `admin` workspace role.
- The API receives both the authorized workspace ID and the selected delivery ID.
- List responses are bounded to 200 rows; the UI requests 50.
- Preview is the default. Mutation requires an explicit `apply: true` after a successful preview.
- There is no bulk retry control.
- Responses and UI contain operational metadata only and use `no-store` caching.

## Failure handling

- `404` means the delivery is no longer present in the authorized workspace.
- `409` means the delivery is not currently eligible for retry.
- `503` indicates the internal API or database boundary is unavailable.
- After a successful applied retry, the page reloads the canonical readiness, incidents, history, and dead-letter state.

## Rollback

Remove the two customer proxy routes, the failed-delivery section from the readiness page, its CSS additions, and `apps/web/test/readiness-dead-letter-inbox.test.js`. The underlying admin API and durable queue remain intact.
