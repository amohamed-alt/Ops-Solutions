# Workspace team access and audit trail

Ops Solutions enforces workspace membership at the API layer. Customer sessions never receive the internal admin key, HubSpot tokens, or data belonging to another workspace.

## Roles

| Role | Dashboard | View members | Invite members | Change roles | Remove members | View audit |
|---|---:|---:|---:|---:|---:|---:|
| Viewer | Yes | Yes | No | No | No | No |
| Admin | Yes | Yes | Yes | No | No | Yes |
| Owner | Yes | Yes | Yes | Yes | Yes | Yes |

A workspace cannot lose its final owner. Attempts to demote or remove the last owner return `409 LAST_OWNER_REQUIRED`.

## Invitation lifecycle

Invitations expire after seven days. Only a SHA-256 hash of the invitation token is stored. The plaintext token is returned once when the invitation is created so the web layer can deliver or copy the invite URL.

- `POST /api/v1/customer/workspaces/:workspaceId/invitations`
- `GET /api/v1/customer/workspaces/:workspaceId/invitations`
- `DELETE /api/v1/customer/workspaces/:workspaceId/invitations/:invitationId`
- `POST /api/v1/auth/invitations/:token/accept`

The signed-in email must match the invitation email. Reissuing an invitation for the same pending email rotates the token and expiry.

## Member management

- `GET /api/v1/customer/workspaces/:workspaceId/members`
- `PATCH /api/v1/customer/workspaces/:workspaceId/members/:userId`
- `DELETE /api/v1/customer/workspaces/:workspaceId/members/:userId`

Role changes and removals require an owner session.

## Audit events

- `GET /api/v1/customer/workspaces/:workspaceId/audit?limit=50&before=<timestamp>`

The audit log currently captures workspace creation, HubSpot connection, invitations, invitation acceptance, invitation revocation, role changes, and member removal. Events store hashed source IPs and structured metadata without storing session tokens or credentials.

## Security notes

- Session and invitation tokens are stored only as hashes.
- Passwords use salted `scrypt` hashes.
- Tenant authorization is checked against `workspace_memberships` for every team endpoint.
- Audit queries are workspace-scoped and available only to admins and owners.
- The API logger redacts passwords, session headers, admin keys, OAuth codes, and infrastructure secrets.
