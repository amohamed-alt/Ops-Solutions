const WRITER_ROLES = new Set(['owner', 'admin']);

const DEFAULTS = Object.freeze({
  monthlyRevenueTarget: 0,
  quarterlyRevenueTarget: 0,
  annualRevenueTarget: 0,
  monthlyCallTarget: 0,
  monthlyMeetingTarget: 0,
  pipelineCoverageTarget: 3,
  defaultProbability: 35,
  staleDealDays: 21,
  highValueThreshold: 0,
  ownerTargets: {}
});

function numberInRange(value, fallback, minimum, maximum, label) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    const error = new Error(`${label} must be between ${minimum} and ${maximum}.`);
    error.statusCode = 400;
    error.category = 'INVALID_WORKSPACE_GOALS';
    throw error;
  }
  return parsed;
}

function integerInRange(value, fallback, minimum, maximum, label) {
  return Math.round(numberInRange(value, fallback, minimum, maximum, label));
}

function normalizeOwnerTargets(value) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Owner targets must be an object keyed by HubSpot owner ID.');
    error.statusCode = 400;
    error.category = 'INVALID_WORKSPACE_GOALS';
    throw error;
  }
  const entries = Object.entries(value);
  if (entries.length > 250) {
    const error = new Error('Owner targets cannot contain more than 250 owners.');
    error.statusCode = 400;
    error.category = 'INVALID_WORKSPACE_GOALS';
    throw error;
  }
  return Object.fromEntries(entries.map(([ownerId, target]) => {
    const safeOwnerId = String(ownerId ?? '').trim().slice(0, 120);
    if (!safeOwnerId) {
      const error = new Error('Every owner target requires a HubSpot owner ID.');
      error.statusCode = 400;
      error.category = 'INVALID_WORKSPACE_GOALS';
      throw error;
    }
    const source = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
    return [safeOwnerId, {
      revenueTarget: numberInRange(source.revenueTarget, 0, 0, 1_000_000_000_000_000, 'Owner revenue target'),
      callTarget: integerInRange(source.callTarget, 0, 0, 1_000_000_000, 'Owner call target'),
      meetingTarget: integerInRange(source.meetingTarget, 0, 0, 1_000_000_000, 'Owner meeting target')
    }];
  }));
}

export function normalizeWorkspaceGoals(input = {}) {
  return {
    monthlyRevenueTarget: numberInRange(input.monthlyRevenueTarget, DEFAULTS.monthlyRevenueTarget, 0, 1_000_000_000_000_000, 'Monthly revenue target'),
    quarterlyRevenueTarget: numberInRange(input.quarterlyRevenueTarget, DEFAULTS.quarterlyRevenueTarget, 0, 1_000_000_000_000_000, 'Quarterly revenue target'),
    annualRevenueTarget: numberInRange(input.annualRevenueTarget, DEFAULTS.annualRevenueTarget, 0, 1_000_000_000_000_000, 'Annual revenue target'),
    monthlyCallTarget: integerInRange(input.monthlyCallTarget, DEFAULTS.monthlyCallTarget, 0, 1_000_000_000, 'Monthly call target'),
    monthlyMeetingTarget: integerInRange(input.monthlyMeetingTarget, DEFAULTS.monthlyMeetingTarget, 0, 1_000_000_000, 'Monthly meeting target'),
    pipelineCoverageTarget: numberInRange(input.pipelineCoverageTarget, DEFAULTS.pipelineCoverageTarget, 0.1, 100, 'Pipeline coverage target'),
    defaultProbability: numberInRange(input.defaultProbability, DEFAULTS.defaultProbability, 0, 100, 'Default deal probability'),
    staleDealDays: integerInRange(input.staleDealDays, DEFAULTS.staleDealDays, 1, 365, 'Stale-deal threshold'),
    highValueThreshold: numberInRange(input.highValueThreshold, DEFAULTS.highValueThreshold, 0, 1_000_000_000_000_000, 'High-value deal threshold'),
    ownerTargets: normalizeOwnerTargets(input.ownerTargets)
  };
}

export async function ensureWorkspaceGoalsSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS workspace_goals (
      workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      monthly_revenue_target NUMERIC(24,4) NOT NULL DEFAULT 0,
      quarterly_revenue_target NUMERIC(24,4) NOT NULL DEFAULT 0,
      annual_revenue_target NUMERIC(24,4) NOT NULL DEFAULT 0,
      monthly_call_target INTEGER NOT NULL DEFAULT 0,
      monthly_meeting_target INTEGER NOT NULL DEFAULT 0,
      pipeline_coverage_target NUMERIC(8,3) NOT NULL DEFAULT 3,
      default_probability NUMERIC(6,3) NOT NULL DEFAULT 35,
      stale_deal_days INTEGER NOT NULL DEFAULT 21,
      high_value_threshold NUMERIC(24,4) NOT NULL DEFAULT 0,
      owner_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (monthly_revenue_target >= 0),
      CHECK (quarterly_revenue_target >= 0),
      CHECK (annual_revenue_target >= 0),
      CHECK (monthly_call_target >= 0),
      CHECK (monthly_meeting_target >= 0),
      CHECK (pipeline_coverage_target > 0),
      CHECK (default_probability BETWEEN 0 AND 100),
      CHECK (stale_deal_days BETWEEN 1 AND 365),
      CHECK (high_value_threshold >= 0)
    );
    CREATE INDEX IF NOT EXISTS workspace_goals_updated_idx ON workspace_goals(updated_at DESC);
  `);
}

function serialize(row = {}) {
  return {
    workspaceId: row.workspace_id ?? null,
    monthlyRevenueTarget: Number(row.monthly_revenue_target ?? DEFAULTS.monthlyRevenueTarget),
    quarterlyRevenueTarget: Number(row.quarterly_revenue_target ?? DEFAULTS.quarterlyRevenueTarget),
    annualRevenueTarget: Number(row.annual_revenue_target ?? DEFAULTS.annualRevenueTarget),
    monthlyCallTarget: Number(row.monthly_call_target ?? DEFAULTS.monthlyCallTarget),
    monthlyMeetingTarget: Number(row.monthly_meeting_target ?? DEFAULTS.monthlyMeetingTarget),
    pipelineCoverageTarget: Number(row.pipeline_coverage_target ?? DEFAULTS.pipelineCoverageTarget),
    defaultProbability: Number(row.default_probability ?? DEFAULTS.defaultProbability),
    staleDealDays: Number(row.stale_deal_days ?? DEFAULTS.staleDealDays),
    highValueThreshold: Number(row.high_value_threshold ?? DEFAULTS.highValueThreshold),
    ownerTargets: row.owner_targets && typeof row.owner_targets === 'object' ? row.owner_targets : {},
    updatedAt: row.updated_at ?? null
  };
}

export async function readWorkspaceGoals(postgres, workspaceId) {
  await ensureWorkspaceGoalsSchema(postgres);
  const result = await postgres.query(`
    SELECT w.id AS workspace_id,
           g.monthly_revenue_target, g.quarterly_revenue_target, g.annual_revenue_target,
           g.monthly_call_target, g.monthly_meeting_target, g.pipeline_coverage_target,
           g.default_probability, g.stale_deal_days, g.high_value_threshold,
           g.owner_targets, g.updated_at
    FROM workspaces w
    LEFT JOIN workspace_goals g ON g.workspace_id = w.id
    WHERE w.id = $1
    LIMIT 1
  `, [workspaceId]);
  if (result.rowCount === 0) {
    const error = new Error('Workspace not found.');
    error.statusCode = 404;
    error.category = 'WORKSPACE_NOT_FOUND';
    throw error;
  }
  return serialize(result.rows[0]);
}

export function registerWorkspaceGoalRoutes(app, { postgres, requireViewer, writeAudit }) {
  const schemaReady = ensureWorkspaceGoalsSchema(postgres);
  const basePath = '/api/v1/customer/workspaces/:workspaceId/goals';

  app.get(basePath, { preHandler: requireViewer }, async (request) => {
    await schemaReady;
    return readWorkspaceGoals(postgres, request.params.workspaceId);
  });

  app.put(basePath, { preHandler: requireViewer }, async (request, reply) => {
    if (!WRITER_ROLES.has(request.workspaceMembership?.role)) {
      return reply.code(403).send({
        error: 'workspace_role_required',
        message: 'Admin access is required to update targets and forecasting rules.'
      });
    }
    await schemaReady;
    const input = normalizeWorkspaceGoals(request.body);
    const workspaceId = request.params.workspaceId;
    const actorUserId = request.customer.user.id;
    const result = await postgres.query(`
      INSERT INTO workspace_goals (
        workspace_id, monthly_revenue_target, quarterly_revenue_target, annual_revenue_target,
        monthly_call_target, monthly_meeting_target, pipeline_coverage_target,
        default_probability, stale_deal_days, high_value_threshold,
        owner_targets, updated_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,NOW())
      ON CONFLICT (workspace_id) DO UPDATE SET
        monthly_revenue_target = EXCLUDED.monthly_revenue_target,
        quarterly_revenue_target = EXCLUDED.quarterly_revenue_target,
        annual_revenue_target = EXCLUDED.annual_revenue_target,
        monthly_call_target = EXCLUDED.monthly_call_target,
        monthly_meeting_target = EXCLUDED.monthly_meeting_target,
        pipeline_coverage_target = EXCLUDED.pipeline_coverage_target,
        default_probability = EXCLUDED.default_probability,
        stale_deal_days = EXCLUDED.stale_deal_days,
        high_value_threshold = EXCLUDED.high_value_threshold,
        owner_targets = EXCLUDED.owner_targets,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      RETURNING *
    `, [
      workspaceId,
      input.monthlyRevenueTarget,
      input.quarterlyRevenueTarget,
      input.annualRevenueTarget,
      input.monthlyCallTarget,
      input.monthlyMeetingTarget,
      input.pipelineCoverageTarget,
      input.defaultProbability,
      input.staleDealDays,
      input.highValueThreshold,
      JSON.stringify(input.ownerTargets),
      actorUserId
    ]);
    await writeAudit(request, {
      workspaceId,
      actorUserId,
      action: 'workspace.goals_updated',
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: {
        monthlyRevenueTarget: input.monthlyRevenueTarget,
        monthlyCallTarget: input.monthlyCallTarget,
        monthlyMeetingTarget: input.monthlyMeetingTarget,
        pipelineCoverageTarget: input.pipelineCoverageTarget,
        ownerTargetCount: Object.keys(input.ownerTargets).length
      }
    });
    return serialize(result.rows[0]);
  });
}
