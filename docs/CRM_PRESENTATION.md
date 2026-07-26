# CRM Presentation and Object Intelligence

The dashboard keeps synchronized HubSpot values unchanged in `crm_records.properties`.
Display labels are resolved at read time from the workspace's discovered HubSpot schema:

- Property names use `crm_properties.label`.
- Enumeration values use `crm_properties.options[].label`.
- Owners use `crm_owners`.
- Pipelines and deal stages use `crm_pipelines` and `crm_pipeline_stages`.
- Free-text values remain unchanged.

The API returns raw values as stable keys for filters and drill-downs, plus display labels for
the interface and exports. This prevents an internal value such as
`marketingqualifiedlead` from replacing the original HubSpot label
`Marketing Qualified Lead`.

## Revenue reporting breakdowns

The revenue reporting pack includes filter-aware object intelligence:

- Contacts by Lead Status, Lifecycle Stage, Country/Region, and created month.
- Companies by Industry, Country/Region, employee-size band, and created month.

Every segment supports tenant-scoped, parameterized drill-downs. Contact, company, and deal
records open in the connected HubSpot portal when a portal ID is available.

CSV exports use the same resolved labels as the dashboard while retaining raw values only for
server-side filtering.
