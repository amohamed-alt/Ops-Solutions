import { randomBytes } from 'node:crypto';

import { normalizeDisplayName, slugifyWorkspace } from './customer-auth.js';

const DEFAULT_WORKSPACE_LIMIT = 10;

export function normalizeCompanyName(value) {
  return normalizeDisplayName(value).slice(0, 120);
}

export function workspaceLimit(value = DEFAULT_WORKSPACE_LIMIT) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return DEFAULT_WORKSPACE_LIMIT;
  return parsed;
}

export function buildWorkspaceSlug(name, suffix = randomBytes(4).toString('hex')) {
  const base = slugifyWorkspace(name) || 'company';
  return `${base}-${suffix}`.slice(0, 80);
}

export function registerCustomerWorkspaceRoutes(app, {
  postgres,
  withTransaction,
  requireCustomer,
  writeAudit,
  maximumWorkspaces = DEFAULT_WORKSPACE_LIMIT
}) {
  const limit = workspaceLimit(maximumWorkspaces);

  app.post('/api/v1/customer/workspaces', { preHandler: requireCustomer }, async (request, reply) => {
    const name = normalizeCompanyName(request.body?.name ?? request.body?.companyName);
    if (name.length < 2) {
      return reply.code(400).send({
        error: 'invalid_workspace',
        message: 'Company name must be between 2 and 120 characters.'
      });
    }

    const countResult = await postgres.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_memberships
       WHERE user_id = $1`,
      [request.customer.user.id]
    );
    if (Number(countResult.rows[0]?.count ?? 0) >= limit) {
      return reply.code(409).send({
        error: 'workspace_limit_reached',
        message: `Your account can create up to ${limit} company workspaces.`
      });
    }

    const created = await withTransaction(async (client) => {
      let workspace = null;
      for (let attempt = 0; attempt < 5 && !workspace; attempt += 1) {
        const slug = buildWorkspaceSlug(name);
        try {
          const workspaceResult = await client.query(
            `INSERT INTO workspaces(name, slug)
             VALUES ($1, $2)
             RETURNING id, name, slug, status, created_at, updated_at`,
            [name, slug]
          );
          workspace = workspaceResult.rows[0];
        } catch (error) {
          if (error.code !== '23505' || attempt === 4) throw error;
        }
      }

      await client.query(
        `INSERT INTO workspace_memberships(user_id, workspace_id, role)
         VALUES ($1, $2, 'owner')`,
        [request.customer.user.id, workspace.id]
      );
      return workspace;
    });

    await writeAudit(request, {
      workspaceId: created.id,
      actorUserId: request.customer.user.id,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: created.id,
      metadata: { companyName: created.name, source: 'customer_self_service' }
    });

    return reply.code(201).send({
      workspace: {
        id: created.id,
        name: created.name,
        slug: created.slug,
        status: created.status,
        role: 'owner',
        portalId: null,
        hubspotStatus: null,
        lastDiscoveredAt: null
      },
      nextPath: `/onboarding?workspace=${created.id}`
    });
  });
}
