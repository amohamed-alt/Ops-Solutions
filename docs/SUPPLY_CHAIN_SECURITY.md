# Supply-chain security gate

Ops Solutions validates repository contents and JavaScript dependencies independently from the normal build workflow. The security gate is intentionally fail-closed for leaked credentials and newly introduced high-severity dependency risks.

## Checks

### Tracked credential scanner

`scripts/security-gate.mjs` inspects Git-tracked text files and blocks:

- committed `.env` variants other than explicit templates
- private key and keystore files
- private key material
- GitHub, AWS, Slack, Stripe, HubSpot and Google credential formats
- suspicious hard-coded credential assignments

The scanner reports only category, path and line number. It never prints the matched secret value.

Run locally:

```bash
node scripts/security-gate.mjs --format text
node scripts/security-gate.mjs --format json
```

Exit codes:

- `0`: no findings
- `2`: credential or sensitive-file finding
- `4`: configuration or repository inspection failure

### Dependency policy

Every application package is installed from its lockfile with lifecycle scripts disabled, then audited using production dependencies only. High and critical advisories fail the workflow.

Pull requests also run GitHub's dependency-review action. New dependencies fail when they introduce high-severity vulnerabilities or use GPL-3.0/AGPL-3.0 licenses that conflict with the intended commercial SaaS distribution. Exceptions require an explicit legal and engineering review rather than silently weakening the workflow.

### CodeQL

GitHub CodeQL runs JavaScript/TypeScript `security-extended` queries for pull requests, pushes to `main`, weekly scheduled checks and manual runs. Findings are uploaded to GitHub code scanning using the minimum required permissions.

## Workflow permissions

The default workflow token is read-only. Only the CodeQL job receives `security-events: write`, and the dependency-review job receives pull-request read access. No production secrets, deployment keys or customer data are available to this workflow.

## Incident handling

When the credential scanner fails:

1. Do not merely delete the string and rerun CI.
2. Assume the credential was exposed to Git history and action logs.
3. Revoke or rotate it in the owning provider.
4. Replace it only in `/root/Ops-Solutions/.env` or the appropriate GitHub Actions secret.
5. Remove the committed value and verify the scanner passes.
6. Purge repository history only after assessing clones, forks and deployment impact.

When dependency review or npm audit fails, upgrade or replace the package. Temporary exceptions must be documented with the advisory, affected surface, compensating controls, owner and expiry date.

## Rollback

Removing `.github/workflows/security-gate.yml` disables the hosted checks. Removing `scripts/security-gate.mjs` and its tests disables the local credential scanner. Rollback does not alter production data, credentials, HubSpot integrations or deployment state.
