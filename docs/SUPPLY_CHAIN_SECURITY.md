# Supply-chain security gate

Ops Solutions validates repository contents and JavaScript dependencies independently from the normal build workflow. The security gate is intentionally fail-closed for leaked credentials and high-severity production dependency risks.

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

### Production dependency audit

The repository currently does not commit npm lockfiles. To keep the security check functional without pretending builds are deterministic, the workflow creates an ephemeral package lock for each application with lifecycle scripts disabled and then runs:

```bash
npm audit --omit=dev --audit-level=high
```

High and critical production advisories fail the workflow. The generated lockfiles remain untracked runner artifacts and the workflow verifies that no tracked file was modified.

Committing reviewed lockfiles remains recommended future work because it would make installs deterministic and enable richer GitHub dependency-diff analysis. That change should be handled separately after validating the generated dependency trees for API, worker and web.

### Portable GitHub configuration

The gate deliberately avoids requiring GitHub Advanced Security. Dependency Review and CodeQL were evaluated but are not enabled as required checks because availability depends on repository licensing and security-feature configuration. The current controls therefore run consistently on pull requests, pushes to `main`, weekly schedules and manual dispatches.

## Workflow permissions

The workflow token has read-only repository contents permission. Checkout credentials are not persisted. No production secrets, deployment keys or customer data are available to the workflow.

## Incident handling

When the credential scanner fails:

1. Do not merely delete the string and rerun CI.
2. Assume the credential was exposed to Git history and action logs.
3. Revoke or rotate it in the owning provider.
4. Replace it only in `/root/Ops-Solutions/.env` or the appropriate GitHub Actions secret.
5. Remove the committed value and verify the scanner passes.
6. Purge repository history only after assessing clones, forks and deployment impact.

When npm audit fails, upgrade or replace the package. Temporary exceptions must be documented with the advisory, affected surface, compensating controls, owner and expiry date rather than weakening the audit threshold globally.

## Rollback

Removing `.github/workflows/security-gate.yml` disables the hosted checks. Removing `scripts/security-gate.mjs` and its tests disables the local credential scanner. Rollback does not alter production data, credentials, HubSpot integrations or deployment state.
