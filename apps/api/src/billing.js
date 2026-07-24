const MIGRATION_VERSION = 30;
const MIGRATION_LOCK = 812341260;
const TRIAL_DAYS = 14;
const PLAN_CODES = new Set(['pilot', 'growth', 'scale', 'managed']);
const SUBSCRIPTION_STATUSES = new Set(['trialing', 'active', 'past_due', 'paused', 'trial_expired', 'canceled', 'managed']);

const PLAN_DEFINITIONS = Object.freeze([
  {
    code: 'pilot',
    name: 'Pilot',
    description: 'For a small team validating its HubSpot reporting workspace.',
    monthlyPriceCents: 9900,
    limits: { seats: 5, syncedRecords: 50_000, monthlyExports: 30, scheduledReports: 3, workspaces: 1 },
    features: ['core_dashboards', 'standard_objects', 'csv_exports', 'email_support']
  },
  {
    code: 'growth',
    name: 'Growth',
    description: 'For commercial teams running recurring dashboards and operational reports.',
    monthlyPriceCents: 24900,
    limits: { seats: 20, syncedRecords: 250_000, monthlyExports: 250, scheduledReports: 20, workspaces: 3 },
    features: ['core_dashboards', 'all_objects', 'scheduled_reports', 'pdf_exports', 'retention_budget', 'priority_support']
  },
  {
    code: 'scale',
    name: 'Scale',
    description: 'For larger multi-workspace revenue operations teams.',
    monthlyPriceCents: 59900,
    limits: { seats: 100, syncedRecords: 2_000_000, monthlyExports: 2_000, scheduledReports: 100, workspaces: 10 },
    features: ['core_dashboards', 'all_objects', 'scheduled_reports', 'pdf_exports', 'retention_budget', 'operational_alerts', 'advanced_support']
  },
  {
    code: 'managed',
    name: 'Managed',
    description: 'Grandfathered or contract-managed deployment with operator-controlled limits.',
    monthlyPriceCents: 0,
    limits: { seats: 0, syncedRecords: 0, monthlyExports: 0, scheduledReports: 0, workspaces: 0 },
    features: ['all']
  }
]);

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS billing_plans (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    monthly_price_cents INTEGER NOT NULL CHECK (monthly_price_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    limits JSONB NOT NULL DEFAULT '{}'::jsonb,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS workspace_subscriptions (
    workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    plan_code TEXT NOT NULL REFERENCES billing_plans(code),
    status TEXT NOT NULL CHECK (status IN ('trialing','active','past_due','paused','trial_expired','canceled','managed')),
    provider TEXT NOT NULL DEFAULT 'manual',
    provider_customer_id TEXT,
    provider_subscription_id TEXT,
    trial_started_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ,
    current_period_started_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
    current_period_ends_at TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS workspace_usage_monthly (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    metric TEXT NOT NULL,
    quantity BIGINT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(workspace_id, period_start, metric)
  );

  CREATE TABLE IF NOT EXISTS billing_provider_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    provider_event_id TEXT NOT NULL,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    payload_digest TEXT,
    processed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(provider, provider_event_id)
  );

  CREATE INDEX IF NOT EXISTS workspace_subscriptions_status_idx
    ON workspace_subscriptions(status, trial_ends_at, current_period_ends_at);
  CREATE INDEX IF NOT EXISTS workspace_usage_monthly_workspace_idx
    ON workspace_usage_monthly(workspace_id, period_start DESC);
`;

function billingError(message, category = 'BILLING_REQUEST_INVALID', statusCode = 400) {
  const error = new Error(message);
  error.category = category;
  error.statusCode = statusCode;
  return error;
}

function periodStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function roleCanManage(request) {
  return ['owner', 'admin'].includes(String(request.workspaceMembership?.role || ''));
}

function requireBillingManager(request) {
  if (!roleCanManage(request)) throw billingError('Admin or owner access is required.', 'WORKSPACE_ROLE_REQUIRED', 403);
}

function safePlanCode(value) {
  const code = String(value ?? '').trim().toLowerCase();
  if (!PLAN_CODES.has(code)) throw billingError('Unknown billing plan.');
  return code;
}

function serializePlan(row) {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    monthlyPriceCents: Number(row.monthly_price_cents || 0),
    currency: row.currency,
    limits: row.limits ?? {},
    features: row.features ?? [],
    active: row.active
  };
}

function serializeSubscription(row) {
  return {
    workspaceId: row.workspace_id,
    planCode: row.plan_code,
    status: row.status,
    provider: row.provider,
    trialStartedAt: row.trial_started_at,
    trialEndsAt: row.trial_ends_at,
    currentPeriodStartedAt: row.current_period_started_at,
    currentPeriodEndsAt: row.current_period_ends_at,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    canceledAt: row.canceled_at,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function ensureBillingSchema(postgres) {
  const client = await postgres.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    const existing = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [MIGRATION_VERSION]);
    if (existing.rowCount === 0) {
      await client.query('BEGIN');
      try {
        await client.query(SCHEMA_SQL);
        for (const plan of PLAN_DEFINITIONS) {
          await client.query(
            `INSERT INTO billing_plans(code,name,description,monthly_price_cents,currency,limits,features)
             VALUES($1,$2,$3,$4,'USD',$5::jsonb,$6::jsonb)
             ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,
               monthly_price_cents=EXCLUDED.monthly_price_cents,limits=EXCLUDED.limits,
               features=EXCLUDED.features,updated_at=NOW()`,
            [plan.code, plan.name, plan.description, plan.monthlyPriceCents, JSON.stringify(plan.limits), JSON.stringify(plan.features)]
          );
        }
        await client.query(
          `INSERT INTO workspace_subscriptions(workspace_id,plan_code,status,provider,metadata)
           SELECT id,'managed','managed','manual','{"grandfathered":true}'::jsonb FROM workspaces
           ON CONFLICT(workspace_id) DO NOTHING`
        );
        await client.query('INSERT INTO schema_migrations(version,name) VALUES($1,$2)', [MIGRATION_VERSION, 'provider_neutral_billing_lifecycle']);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied: existing.rowCount === 0, version: MIGRATION_VERSION };
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

export async function ensureWorkspaceSubscription(postgres, workspaceId, now = new Date()) {
  await postgres.query(
    `INSERT INTO workspace_subscriptions(
       workspace_id,plan_code,status,provider,trial_started_at,trial_ends_at,current_period_started_at,current_period_ends_at
     ) VALUES($1,'growth','trialing','manual',$2,$3,date_trunc('month',$2::timestamptz),date_trunc('month',$2::timestamptz)+INTERVAL '1 month')
     ON CONFLICT(workspace_id) DO NOTHING`,
    [workspaceId, now, new Date(now.getTime() + TRIAL_DAYS * 86_400_000)]
  );
  await postgres.query(
    `UPDATE workspace_subscriptions SET status='trial_expired',updated_at=NOW()
     WHERE workspace_id=$1 AND status='trialing' AND trial_ends_at <= $2`,
    [workspaceId, now]
  );
  const result = await postgres.query(
    `SELECT s.*,p.name AS plan_name,p.description AS plan_description,p.monthly_price_cents,p.currency,p.limits,p.features,p.active AS plan_active
     FROM workspace_subscriptions s JOIN billing_plans p ON p.code=s.plan_code WHERE s.workspace_id=$1`,
    [workspaceId]
  );
  return result.rows[0];
}

async function liveUsage(postgres, workspaceId, now = new Date()) {
  const month = periodStart(now);
  const [records, seats, schedules, counters] = await Promise.all([
    postgres.query('SELECT COUNT(*)::bigint AS quantity FROM crm_records WHERE workspace_id=$1 AND archived=FALSE', [workspaceId]),
    postgres.query('SELECT COUNT(*)::bigint AS quantity FROM workspace_memberships WHERE workspace_id=$1', [workspaceId]),
    postgres.query('SELECT COUNT(*)::bigint AS quantity FROM scheduled_report_schedules WHERE workspace_id=$1 AND enabled=TRUE', [workspaceId]),
    postgres.query('SELECT metric,quantity FROM workspace_usage_monthly WHERE workspace_id=$1 AND period_start=$2', [workspaceId, month])
  ]);
  const monthly = Object.fromEntries(counters.rows.map((row) => [row.metric, Number(row.quantity || 0)]));
  return {
    periodStart: month,
    syncedRecords: Number(records.rows[0]?.quantity || 0),
    seats: Number(seats.rows[0]?.quantity || 0),
    scheduledReports: Number(schedules.rows[0]?.quantity || 0),
    monthlyExports: Number(monthly.monthly_exports || 0),
    alertDeliveries: Number(monthly.alert_deliveries || 0)
  };
}

function entitlementState(subscription, plan, usage) {
  const blockingStatus = ['trial_expired', 'paused', 'canceled'].includes(subscription.status);
  const limits = plan.limits ?? {};
  const metrics = {
    seats: usage.seats,
    syncedRecords: usage.syncedRecords,
    monthlyExports: usage.monthlyExports,
    scheduledReports: usage.scheduledReports
  };
  const quotas = Object.fromEntries(Object.entries(metrics).map(([metric, quantity]) => {
    const limit = Number(limits[metric] || 0);
    return [metric, {
      quantity,
      limit,
      unlimited: limit === 0,
      remaining: limit === 0 ? null : Math.max(0, limit - quantity),
      exceeded: limit > 0 && quantity >= limit
    }];
  }));
  return {
    access: blockingStatus ? 'restricted' : 'active',
    blockingReason: blockingStatus ? subscription.status : null,
    quotas
  };
}

export async function getBillingState(postgres, workspaceId, now = new Date()) {
  const row = await ensureWorkspaceSubscription(postgres, workspaceId, now);
  const usage = await liveUsage(postgres, workspaceId, now);
  const plan = serializePlan({
    code: row.plan_code,
    name: row.plan_name,
    description: row.plan_description,
    monthly_price_cents: row.monthly_price_cents,
    currency: row.currency,
    limits: row.limits,
    features: row.features,
    active: row.plan_active
  });
  const subscription = serializeSubscription(row);
  return { subscription, plan, usage, entitlements: entitlementState(subscription, plan, usage) };
}

export async function recordBillingUsage(postgres, workspaceId, metric, quantity = 1, now = new Date()) {
  const normalizedMetric = String(metric ?? '').trim().toLowerCase().slice(0, 80);
  const increment = Math.max(0, Math.floor(Number(quantity) || 0));
  if (!normalizedMetric || increment === 0) return;
  await postgres.query(
    `INSERT INTO workspace_usage_monthly(workspace_id,period_start,metric,quantity)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(workspace_id,period_start,metric)
     DO UPDATE SET quantity=workspace_usage_monthly.quantity+EXCLUDED.quantity,updated_at=NOW()`,
    [workspaceId, periodStart(now), normalizedMetric, increment]
  );
}

export async function assertBillingQuota(postgres, workspaceId, metric, increment = 1) {
  const state = await getBillingState(postgres, workspaceId);
  if (state.entitlements.access !== 'active') {
    throw billingError('The workspace subscription is not active.', 'SUBSCRIPTION_RESTRICTED', 402);
  }
  const quota = state.entitlements.quotas[metric];
  if (quota && !quota.unlimited && quota.quantity + increment > quota.limit) {
    throw billingError(`The ${metric} limit for this plan has been reached.`, 'PLAN_LIMIT_REACHED', 402);
  }
  return state;
}

export function registerBillingRoutes(app, { postgres, requireViewer, writeAudit }) {
  const base = '/api/v1/customer/workspaces/:workspaceId/billing';

  app.get(base, { preHandler: requireViewer }, async (request) => {
    const [state, plans] = await Promise.all([
      getBillingState(postgres, request.params.workspaceId),
      postgres.query('SELECT * FROM billing_plans WHERE active=TRUE ORDER BY monthly_price_cents,code')
    ]);
    return { ...state, plans: plans.rows.map(serializePlan), liveCheckoutAvailable: false };
  });

  app.post(`${base}/start-trial`, { preHandler: requireViewer }, async (request) => {
    requireBillingManager(request);
    const current = await ensureWorkspaceSubscription(postgres, request.params.workspaceId);
    if (current.status === 'trialing' || current.trial_started_at) {
      throw billingError('A trial has already been used for this workspace.', 'TRIAL_ALREADY_USED', 409);
    }
    const now = new Date();
    await postgres.query(
      `UPDATE workspace_subscriptions SET plan_code='growth',status='trialing',provider='manual',
       trial_started_at=$2,trial_ends_at=$3,cancel_at_period_end=FALSE,canceled_at=NULL,updated_at=NOW()
       WHERE workspace_id=$1`,
      [request.params.workspaceId, now, new Date(now.getTime() + TRIAL_DAYS * 86_400_000)]
    );
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'billing.trial_started',
      targetType: 'workspace_subscription',
      targetId: request.params.workspaceId,
      metadata: { planCode: 'growth', trialDays: TRIAL_DAYS }
    });
    return getBillingState(postgres, request.params.workspaceId);
  });

  app.patch(`${base}/subscription`, { preHandler: requireViewer }, async (request) => {
    requireBillingManager(request);
    const planCode = safePlanCode(request.body?.planCode);
    if (planCode === 'managed' && request.workspaceMembership.role !== 'owner') {
      throw billingError('Owner access is required for a managed plan.', 'WORKSPACE_ROLE_REQUIRED', 403);
    }
    const status = planCode === 'managed' ? 'managed' : 'active';
    await ensureWorkspaceSubscription(postgres, request.params.workspaceId);
    await postgres.query(
      `UPDATE workspace_subscriptions SET plan_code=$2,status=$3,provider='manual',
       current_period_started_at=NOW(),current_period_ends_at=NOW()+INTERVAL '1 month',
       cancel_at_period_end=FALSE,canceled_at=NULL,updated_at=NOW() WHERE workspace_id=$1`,
      [request.params.workspaceId, planCode, status]
    );
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'billing.plan_changed',
      targetType: 'workspace_subscription',
      targetId: request.params.workspaceId,
      metadata: { planCode, provider: 'manual' }
    });
    return getBillingState(postgres, request.params.workspaceId);
  });

  app.post(`${base}/cancel`, { preHandler: requireViewer }, async (request) => {
    requireBillingManager(request);
    await ensureWorkspaceSubscription(postgres, request.params.workspaceId);
    await postgres.query(
      `UPDATE workspace_subscriptions SET cancel_at_period_end=TRUE,updated_at=NOW() WHERE workspace_id=$1`,
      [request.params.workspaceId]
    );
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'billing.cancellation_scheduled',
      targetType: 'workspace_subscription',
      targetId: request.params.workspaceId
    });
    return getBillingState(postgres, request.params.workspaceId);
  });

  app.post(`${base}/reactivate`, { preHandler: requireViewer }, async (request) => {
    requireBillingManager(request);
    await postgres.query(
      `UPDATE workspace_subscriptions SET cancel_at_period_end=FALSE,canceled_at=NULL,
       status=CASE WHEN status='canceled' THEN 'active' ELSE status END,updated_at=NOW() WHERE workspace_id=$1`,
      [request.params.workspaceId]
    );
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'billing.reactivated',
      targetType: 'workspace_subscription',
      targetId: request.params.workspaceId
    });
    return getBillingState(postgres, request.params.workspaceId);
  });
}
