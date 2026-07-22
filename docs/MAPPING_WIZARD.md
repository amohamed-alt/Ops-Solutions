# Customer semantic mapping wizard

The mapping wizard lets workspace members review how customer-specific HubSpot properties are translated into stable semantic fields used by dashboards and reporting.

## Security model

- Read access requires viewer membership for the selected workspace.
- Approve, update, rollback, and remove operations require admin or owner membership.
- Every API query includes the selected `workspace_id`.
- The browser uses the signed-in customer session; `ADMIN_API_KEY`, HubSpot tokens, OAuth state, and database credentials never reach the client.
- Property and semantic identifiers are validated before being used in route paths or SQL parameters.
- SQL values remain parameterized.

## Suggestion behavior

Suggestions remain deterministic and are generated from:

- property internal name and label
- description and group metadata
- HubSpot field/data types
- dropdown option patterns

Confidence bands:

- high: 80% or greater
- medium: 55% to 79%
- low: below 55%

No low-confidence or other suggestion is approved automatically by the customer mapping API. An admin or owner must explicitly save a mapping.

## Evidence and normalization

The customer UI shows:

- discovered property metadata
- HubSpot-defined versus custom status
- option counts and option values
- up to eight synchronized sample values when CRM records are available
- deterministic suggestion reasons
- report modules affected by the semantic field

Value mappings are limited to 100 entries. Blank keys and targets are ignored, and values are bounded before persistence.

## Version history

Schema version 4 creates `property_mapping_versions`.

Each approval, update, rollback, and removal stores:

- workspace and semantic slot
- selected property
- normalized value mapping
- actor user
- action and source
- previous mapping snapshot
- timestamp

Rollback creates a new version instead of mutating history. A version cannot be restored if its HubSpot property is no longer present in the latest discovery.

## Migration and rollback

The API applies schema version 4 after the workspace foundation and customer authentication schema are available.

Rollback SQL:

```sql
DROP TABLE IF EXISTS property_mapping_versions;
```

Dropping the history table does not delete current rows from `property_mappings`, CRM records, HubSpot connections, or customer workspaces.

## Operations

Recommended validation after deployment:

1. Open `/settings/mappings` as a workspace viewer and confirm read-only access.
2. Open the same workspace as an admin or owner.
3. Approve a high-confidence suggestion.
4. Edit a value normalization and verify a new history entry.
5. Restore the previous version.
6. Remove the mapping and confirm suggestions return to review status.
7. Switch to another company and confirm no properties, mappings, samples, or history cross tenant boundaries.
