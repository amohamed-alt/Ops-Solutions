# Mapping-Aware Analytics Engine

## Design goal

Dashboard metrics must not depend on one customer's internal HubSpot property names. Definitions use semantic concepts such as `lead_quality`, while each workspace supplies an approved property and value mapping.

Example:

```json
{
  "semanticField": "lead_quality",
  "operator": "semantic_equals",
  "value": "highest"
}
```

For one portal this may compile to `rank = A`; for another it may compile to `lead_tier = Tier 1`.

## Safe query DSL

The analytics compiler supports a controlled set of operators:

- `equals`
- `not_equals`
- `in`
- `not_in`
- `exists`
- `missing`
- `gt`, `gte`, `lt`, `lte`
- `before_days`
- `after_days`
- `semantic_equals`

It rejects unsupported object types, operators and unsafe property identifiers. All values and JSON property keys use PostgreSQL parameters.

## Aggregations

- count
- distinct count
- sum
- average
- optional group-by for leaderboards

## Virtual properties

Virtual properties are reusable rule groups computed inside the analytics query rather than written back to HubSpot.

The first SDR template includes:

- Untouched Contact
- Stale Contact
- Deal at Risk

## First template

`apps/api/src/templates/sdr-dashboard.js` contains the first reusable SDR dashboard definition, including KPI cards, activity metrics, an owner leaderboard and a priority-lead drill-down.

## Drill-down

Metric definitions can be reused to list underlying records. Drill-down results are capped at 200 rows per request and ordered by HubSpot update time.

## Remaining wiring

The compiler and template are complete and tested. The next API milestone wires them to authenticated endpoints that load each workspace's approved mappings, execute metrics and return dashboard payloads.
