import { readWorkspaceGoals } from './workspace-goals.js';

const SIGNAL_STATUSES = new Set(['open', 'reviewed', 'snoozed']);

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value, maximum = 240) {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, maximum) : null;
}

function isoDate(value, fallback) {
  const result = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) return fallback;
  const parsed = new Date(`${result}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : result;
}

function dateShift(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inclusiveDays(from, to) {
  return Math.floor((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function normalizeFilters(query = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const to = isoDate(query.to, today);
  const from = isoDate(query.from, dateShift(to, -29));
  if (from > to) {
    const error = new Error('The reporting start date must be on or before the end date.');
    error.statusCode = 400;
    error.category = 'INVALID_REPORTING_RANGE';
    throw error;
  }
  return {
    from,
    to,
    days: inclusiveDays(from, to),
    ownerId: cleanText(query.ownerId),
    country: cleanText(query.country),
    pipelineId: cleanText(query.pipelineId),
    stageId: cleanText(query.stageId),
    leadSource: cleanText(query.leadSource)
  };
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysSince(value, now = new Date()) {
  const parsed = timestamp(value);
  if (!parsed) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86_400_000));
}

function periodTarget(goals, days) {
  const safeDays = Math.max(1, Number(days || 1));
  if (safeDays <= 45 && goals.monthlyRevenueTarget > 0) {
    return goals.monthlyRevenueTarget * (safeDays / 30.4375);
  }
  if (safeDays <= 120 && goals.quarterlyRevenueTarget > 0) {
    return goals.quarterlyRevenueTarget * (safeDays / 91.3125);
  }
  if (goals.annualRevenueTarget > 0) {
    return goals.annualRevenueTarget * (safeDays / 365.25);
  }
  if (goals.quarterlyRevenueTarget > 0) {
    return goals.quarterlyRevenueTarget * (safeDays / 91.3125);
  }
  return goals.monthlyRevenueTarget * (safeDays / 30.4375);
}

function activityTarget(monthlyTarget, days) {
  return Math.max(0, Number(monthlyTarget || 0) * (Math.max(1, days) / 30.4375));
}

function percent(value, target) {
  return target > 0 ? (Number(value || 0) / target) * 100 : null;
}

function safeProbability(value, fallback) {
  const parsed = numeric(value);
  if (parsed <= 0 && value !== 0 && value !== '0') return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function riskForDeal(row, goals, now = new Date()) {
  const reasons = [];
  let score = 0;
  const amount = numeric(row.amount);
  const probability = safeProbability(row.probability, goals.defaultProbability);
  const closeDate = timestamp(row.close_date);
  const nextActivity = timestamp(row.next_activity_date);
  const lastActivity = row.last_activity_date || row.hubspot_updated_at || row.synced_at;
  const inactiveDays = daysSince(lastActivity, now);
  const daysToClose = closeDate ? Math.ceil((closeDate.getTime() - now.getTime()) / 86_400_000) : null;

  if (!nextActivity) {
    score += 25;
    reasons.push('No next activity is scheduled');
  }
  if (closeDate && closeDate < now) {
    score += 30;
    reasons.push('Close date is overdue');
  } else if (daysToClose !== null && daysToClose <= 14) {
    score += 10;
    reasons.push('Close date is within 14 days');
  }
  if (inactiveDays !== null && inactiveDays >= goals.staleDealDays) {
    score += Math.min(25, 15 + Math.floor((inactiveDays - goals.staleDealDays) / 7) * 2);
    reasons.push(`No meaningful activity for ${inactiveDays} days`);
  }
  if (goals.highValueThreshold > 0 && amount >= goals.highValueThreshold) {
    score += 15;
    reasons.push('High-value opportunity requires tighter control');
  }
  if (probability <= 20) {
    score += 5;
    reasons.push('Current probability is low');
  }
  if (!closeDate) {
    score += 10;
    reasons.push('Close date is missing');
  }

  score = Math.max(0, Math.min(100, score));
  const band = score >= 70 ? 'critical' : score >= 45 ? 'high' : score >= 25 ? 'medium' : 'low';
  return {
    score,
    band,
    reasons,
    amount,
    probability,
    inactiveDays,
    daysToClose,
    weightedAmount: amount * (probability / 100)
  };
}

function buildInsights({ forecast, risk, execution, quality, owners }) {
  const insights = [];
  if (forecast.target > 0) {
    if (forecast.expectedLanding < forecast.target) {
      insights.push({
        severity: forecast.expectedLanding < forecast.target * 0.75 ? 'critical' : 'warning',
        category: 'forecast',
        title: 'Forecast is below target',
        message: `Expected landing is ${forecast.attainmentExpected.toFixed(1)}% of target, leaving a gap of ${Math.round(forecast.gap)}.`,
        action: 'Review high-value deals and coverage gaps.'
      });
    } else {
      insights.push({
        severity: 'success',
        category: 'forecast',
        title: 'Forecast is currently on track',
        message: `Expected landing is ${forecast.attainmentExpected.toFixed(1)}% of the selected-period target.`,
        action: 'Protect commit deals and keep next activities current.'
      });
    }
    if (forecast.coverage < forecast.coverageTarget) {
      insights.push({
        severity: 'warning',
        category: 'pipeline',
        title: 'Pipeline coverage needs attention',
        message: `Coverage is ${forecast.coverage.toFixed(2)}x versus the ${forecast.coverageTarget.toFixed(2)}x target.`,
        action: 'Increase qualified pipeline or improve conversion on active deals.'
      });
    }
  } else {
    insights.push({
      severity: 'info',
      category: 'governance',
      title: 'Revenue targets are not configured',
      message: 'Set monthly, quarterly and annual targets to unlock attainment and forecast-gap reporting.',
      action: 'Open Targets & forecast settings.'
    });
  }

  if (risk.criticalDeals > 0) {
    insights.push({
      severity: 'critical',
      category: 'risk',
      title: `${risk.criticalDeals} critical deals need intervention`,
      message: `${Math.round(risk.criticalValue)} in pipeline value is exposed across critical-risk opportunities.`,
      action: 'Open the risk register and assign a next step.'
    });
  } else if (risk.highDeals > 0) {
    insights.push({
      severity: 'warning',
      category: 'risk',
      title: `${risk.highDeals} high-risk deals need review`,
      message: `${Math.round(risk.highValue)} in pipeline value has multiple risk signals.`,
      action: 'Review close dates, inactivity and next activities.'
    });
  }

  if (execution.meetingTarget > 0 && execution.meetingAttainment < 80) {
    insights.push({
      severity: 'warning',
      category: 'execution',
      title: 'Meeting production is behind plan',
      message: `${execution.meetings} meetings represent ${execution.meetingAttainment.toFixed(1)}% of the selected-period target.`,
      action: 'Inspect lead sources and owner activity conversion.'
    });
  }
  if (execution.calls > 0 && execution.meetings / execution.calls < 0.03) {
    insights.push({
      severity: 'warning',
      category: 'conversion',
      title: 'Call-to-meeting conversion is low',
      message: `Only ${((execution.meetings / execution.calls) * 100).toFixed(1)}% of calls converted to meetings.`,
      action: 'Review targeting, dispositions and coaching opportunities.'
    });
  }
  if (quality.missingOwnerContacts > 0) {
    insights.push({
      severity: 'info',
      category: 'data-quality',
      title: 'Unassigned contacts reduce accountability',
      message: `${quality.missingOwnerContacts} contacts do not have a HubSpot owner.`,
      action: 'Assign ownership or create a routing rule.'
    });
  }
  const topOwner = owners[0];
  if (topOwner && forecast.actual > 0 && topOwner.wonRevenue / forecast.actual >= 0.5) {
    insights.push({
      severity: 'info',
      category: 'concentration',
      title: 'Revenue is concentrated in one owner',
      message: `${topOwner.ownerName} generated ${((topOwner.wonRevenue / forecast.actual) * 100).toFixed(1)}% of won revenue in the period.`,
      action: 'Check pipeline distribution and coaching coverage.'
    });
  }
  return insights.slice(0, 6);
}

export async function ensureRevenueIntelligenceSchema(postgres) {
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS revenue_signal_actions (
      workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      signal_key TEXT NOT NULL,
      record_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','snoozed')),
      snoozed_until TIMESTAMPTZ,
      note TEXT,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (workspace_id, signal_key, record_id)
    );
    CREATE INDEX IF NOT EXISTS revenue_signal_actions_status_idx
      ON revenue_signal_actions(workspace_id, status, snoozed_until, updated_at DESC);
  `);
}

async function effectiveOwnerScope(postgres, request, requestedOwnerId) {
  if (request.workspaceMembership?.role !== 'viewer') {
    return { ownerId: requestedOwnerId, enforced: false, reason: null };
  }
  const email = String(request.customer?.user?.email ?? '').trim().toLowerCase();
  if (!email) return { ownerId: '__viewer_without_owner__', enforced: true, reason: 'No user email is available for owner matching.' };
  const result = await postgres.query(`
    SELECT owner_id
    FROM crm_owners
    WHERE workspace_id = $1 AND archived = FALSE AND LOWER(COALESCE(email,'')) = $2
    ORDER BY discovered_at DESC
    LIMIT 1
  `, [request.params.workspaceId, email]);
  return result.rowCount > 0
    ? { ownerId: String(result.rows[0].owner_id), enforced: true, reason: null }
    : { ownerId: '__viewer_without_owner__', enforced: true, reason: 'Your account is not mapped to a HubSpot owner.' };
}

async function queryDealRows(postgres, workspaceId, filters, goals) {
  const result = await postgres.query(`
    SELECT r.record_id, r.properties, r.hubspot_updated_at, r.synced_at,
           CASE WHEN COALESCE(r.properties->>'amount','') ~ '^-?[0-9]+(\\.[0-9]+)?$'
             THEN (r.properties->>'amount')::numeric ELSE 0 END AS amount,
           NULLIF(r.properties->>'closedate','') AS close_date,
           NULLIF(r.properties->>'hs_next_activity_date','') AS next_activity_date,
           COALESCE(NULLIF(r.properties->>'hs_last_activity_date',''), NULLIF(r.properties->>'notes_last_contacted','')) AS last_activity_date,
           CASE
             WHEN COALESCE(NULLIF(r.properties->>'hs_deal_stage_probability',''), NULLIF(s.metadata->>'probability','')) ~ '^[0-9]+(\\.[0-9]+)?$'
               THEN COALESCE(NULLIF(r.properties->>'hs_deal_stage_probability',''), NULLIF(s.metadata->>'probability',''))::numeric
             ELSE $9::numeric
           END AS probability,
           COALESCE(NULLIF(r.properties->>'hubspot_owner_id',''),'Unassigned') AS owner_id,
           COALESCE(NULLIF(CONCAT_WS(' ',o.first_name,o.last_name),''),o.email,CONCAT('Owner ',r.properties->>'hubspot_owner_id'),'Unassigned') AS owner_name,
           a.status AS action_status, a.snoozed_until, a.note AS action_note
    FROM crm_records r
    LEFT JOIN crm_pipeline_stages s
      ON s.workspace_id = r.workspace_id AND s.object_type = 'deals'
     AND s.pipeline_id = r.properties->>'pipeline' AND s.stage_id = r.properties->>'dealstage'
    LEFT JOIN crm_owners o
      ON o.workspace_id = r.workspace_id AND o.owner_id = r.properties->>'hubspot_owner_id'
    LEFT JOIN revenue_signal_actions a
      ON a.workspace_id = r.workspace_id AND a.signal_key = 'deal-risk' AND a.record_id = r.record_id
    WHERE r.workspace_id = $1 AND r.object_type = 'deals' AND r.archived = FALSE
      AND LOWER(COALESCE(r.properties->>'hs_is_closed','false')) NOT IN ('true','1')
      AND ($4::text IS NULL OR COALESCE(NULLIF(r.properties->>'hubspot_owner_id',''),'Unassigned') = $4)
      AND ($5::text IS NULL OR NULLIF(r.properties->>'pipeline','') = $5)
      AND ($6::text IS NULL OR NULLIF(r.properties->>'dealstage','') = $6)
      AND (
        ($7::text IS NULL AND $8::text IS NULL)
        OR EXISTS (
          SELECT 1 FROM crm_record_associations ca
          JOIN crm_records c ON c.workspace_id = ca.workspace_id
            AND c.object_type = 'contacts' AND c.record_id = ca.to_record_id AND c.archived = FALSE
          WHERE ca.workspace_id = r.workspace_id
            AND ca.from_object_type = 'deals' AND ca.from_record_id = r.record_id AND ca.to_object_type = 'contacts'
            AND ($7::text IS NULL OR COALESCE(NULLIF(c.properties->>'country',''),NULLIF(c.properties->>'hs_country_region_code',''),'Unknown') = $7)
            AND ($8::text IS NULL OR COALESCE(NULLIF(c.properties->>'hs_analytics_source',''),NULLIF(c.properties->>'lead_source',''),NULLIF(c.properties->>'original_source',''),'Unknown') = $8)
        )
      )
    ORDER BY amount DESC, r.hubspot_updated_at DESC
    LIMIT 5000
  `, [
    workspaceId,
    filters.from,
    filters.to,
    filters.ownerId,
    filters.pipelineId,
    filters.stageId,
    filters.country,
    filters.leadSource,
    goals.defaultProbability
  ]);
  return result.rows;
}

async function periodSnapshot(postgres, workspaceId, filters) {
  const values = [workspaceId, filters.from, filters.to, filters.ownerId];
  const [won, activity, quality, owners] = await Promise.all([
    postgres.query(`
      SELECT COALESCE(SUM(CASE WHEN COALESCE(r.properties->>'amount','') ~ '^-?[0-9]+(\\.[0-9]+)?$'
        THEN (r.properties->>'amount')::numeric ELSE 0 END),0)::numeric AS won_revenue
      FROM crm_records r
      WHERE r.workspace_id=$1 AND r.object_type='deals' AND r.archived=FALSE
        AND LOWER(COALESCE(r.properties->>'hs_is_closed_won','false')) IN ('true','1')
        AND COALESCE(NULLIF(r.properties->>'closedate','')::timestamptz,r.hubspot_updated_at,r.synced_at) >= $2::date
        AND COALESCE(NULLIF(r.properties->>'closedate','')::timestamptz,r.hubspot_updated_at,r.synced_at) < ($3::date + INTERVAL '1 day')
        AND ($4::text IS NULL OR COALESCE(NULLIF(r.properties->>'hubspot_owner_id',''),'Unassigned')=$4)
    `, values),
    postgres.query(`
      SELECT COUNT(*) FILTER (WHERE r.object_type='calls')::bigint AS calls,
             COUNT(*) FILTER (WHERE r.object_type='meetings')::bigint AS meetings
      FROM crm_records r
      WHERE r.workspace_id=$1 AND r.object_type IN ('calls','meetings') AND r.archived=FALSE
        AND COALESCE(NULLIF(r.properties->>'hs_timestamp','')::timestamptz,NULLIF(r.properties->>'hs_meeting_start_time','')::timestamptz,r.hubspot_created_at,r.synced_at) >= $2::date
        AND COALESCE(NULLIF(r.properties->>'hs_timestamp','')::timestamptz,NULLIF(r.properties->>'hs_meeting_start_time','')::timestamptz,r.hubspot_created_at,r.synced_at) < ($3::date + INTERVAL '1 day')
        AND ($4::text IS NULL OR COALESCE(NULLIF(r.properties->>'hubspot_owner_id',''),NULLIF(r.properties->>'hs_activity_assigned_to_user_id',''),'Unassigned')=$4)
    `, values),
    postgres.query(`
      SELECT COUNT(*) FILTER (WHERE NULLIF(r.properties->>'hubspot_owner_id','') IS NULL)::bigint AS missing_owner
      FROM crm_records r
      WHERE r.workspace_id=$1 AND r.object_type='contacts' AND r.archived=FALSE
    `, [workspaceId]),
    postgres.query(`
      WITH activity AS (
        SELECT COALESCE(NULLIF(r.properties->>'hubspot_owner_id',''),NULLIF(r.properties->>'hs_activity_assigned_to_user_id',''),'Unassigned') owner_id,
               COUNT(*) FILTER (WHERE r.object_type='calls')::bigint calls,
               COUNT(*) FILTER (WHERE r.object_type='meetings')::bigint meetings
        FROM crm_records r
        WHERE r.workspace_id=$1 AND r.object_type IN ('calls','meetings') AND r.archived=FALSE
          AND COALESCE(NULLIF(r.properties->>'hs_timestamp','')::timestamptz,NULLIF(r.properties->>'hs_meeting_start_time','')::timestamptz,r.hubspot_created_at,r.synced_at) >= $2::date
          AND COALESCE(NULLIF(r.properties->>'hs_timestamp','')::timestamptz,NULLIF(r.properties->>'hs_meeting_start_time','')::timestamptz,r.hubspot_created_at,r.synced_at) < ($3::date + INTERVAL '1 day')
        GROUP BY 1
      ), won AS (
        SELECT COALESCE(NULLIF(r.properties->>'hubspot_owner_id',''),'Unassigned') owner_id,
               COALESCE(SUM(CASE WHEN COALESCE(r.properties->>'amount','') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN (r.properties->>'amount')::numeric ELSE 0 END),0)::numeric won_revenue
        FROM crm_records r
        WHERE r.workspace_id=$1 AND r.object_type='deals' AND r.archived=FALSE
          AND LOWER(COALESCE(r.properties->>'hs_is_closed_won','false')) IN ('true','1')
          AND COALESCE(NULLIF(r.properties->>'closedate','')::timestamptz,r.hubspot_updated_at,r.synced_at) >= $2::date
          AND COALESCE(NULLIF(r.properties->>'closedate','')::timestamptz,r.hubspot_updated_at,r.synced_at) < ($3::date + INTERVAL '1 day')
        GROUP BY 1
      ), keys AS (SELECT owner_id FROM activity UNION SELECT owner_id FROM won)
      SELECT k.owner_id,
             COALESCE(NULLIF(CONCAT_WS(' ',o.first_name,o.last_name),''),o.email,CASE WHEN k.owner_id='Unassigned' THEN 'Unassigned' ELSE CONCAT('Owner ',k.owner_id) END) owner_name,
             COALESCE(a.calls,0)::bigint calls, COALESCE(a.meetings,0)::bigint meetings,
             COALESCE(w.won_revenue,0)::numeric won_revenue
      FROM keys k
      LEFT JOIN activity a ON a.owner_id=k.owner_id
      LEFT JOIN won w ON w.owner_id=k.owner_id
      LEFT JOIN crm_owners o ON o.workspace_id=$1 AND o.owner_id=k.owner_id
      ORDER BY won_revenue DESC, meetings DESC, calls DESC
      LIMIT 100
    `, [workspaceId, filters.from, filters.to])
  ]);
  return {
    wonRevenue: numeric(won.rows[0]?.won_revenue),
    calls: numeric(activity.rows[0]?.calls),
    meetings: numeric(activity.rows[0]?.meetings),
    missingOwnerContacts: numeric(quality.rows[0]?.missing_owner),
    owners: owners.rows
  };
}

export async function buildRevenueIntelligence(postgres, workspaceId, rawFilters = {}, scope = {}) {
  await ensureRevenueIntelligenceSchema(postgres);
  const filters = normalizeFilters({ ...rawFilters, ownerId: scope.ownerId ?? rawFilters.ownerId });
  const goals = await readWorkspaceGoals(postgres, workspaceId);
  const [deals, snapshot] = await Promise.all([
    queryDealRows(postgres, workspaceId, filters, goals),
    periodSnapshot(postgres, workspaceId, filters)
  ]);
  const now = new Date();
  const scoredDeals = deals.map((row) => {
    const risk = riskForDeal(row, goals, now);
    return {
      id: String(row.record_id),
      name: row.properties?.dealname || `Deal ${row.record_id}`,
      pipelineId: row.properties?.pipeline || null,
      stageId: row.properties?.dealstage || null,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      closeDate: row.close_date,
      nextActivityDate: row.next_activity_date,
      action: {
        status: row.action_status || 'open',
        snoozedUntil: row.snoozed_until || null,
        note: row.action_note || null
      },
      ...risk
    };
  });

  const visibleRiskDeals = scoredDeals.filter((deal) => {
    if (deal.action.status !== 'snoozed') return true;
    const until = timestamp(deal.action.snoozedUntil);
    return !until || until <= now;
  });
  const target = periodTarget(goals, filters.days);
  const actual = snapshot.wonRevenue;
  const periodEnd = new Date(`${filters.to}T23:59:59.999Z`);
  const periodStart = new Date(`${filters.from}T00:00:00.000Z`);
  const forecastable = scoredDeals.filter((deal) => {
    const close = timestamp(deal.closeDate);
    return close && close >= periodStart && close <= periodEnd;
  });
  const openPipeline = scoredDeals.reduce((sum, deal) => sum + deal.amount, 0);
  const weightedPipeline = forecastable.reduce((sum, deal) => sum + deal.weightedAmount, 0);
  const commitPipeline = forecastable.filter((deal) => deal.probability >= 80).reduce((sum, deal) => sum + deal.amount, 0);
  const bestCasePipeline = forecastable.filter((deal) => deal.probability >= 50).reduce((sum, deal) => sum + deal.amount, 0);
  const expectedLanding = actual + weightedPipeline;
  const commitLanding = actual + commitPipeline;
  const bestCaseLanding = actual + bestCasePipeline;
  const remainingTarget = Math.max(0, target - actual);
  const coverage = remainingTarget > 0 ? openPipeline / remainingTarget : openPipeline > 0 ? 999 : 0;
  const forecast = {
    target,
    actual,
    remainingTarget,
    openPipeline,
    weightedPipeline,
    commitPipeline,
    bestCasePipeline,
    expectedLanding,
    commitLanding,
    bestCaseLanding,
    gap: Math.max(0, target - expectedLanding),
    coverage,
    coverageTarget: goals.pipelineCoverageTarget,
    attainmentActual: percent(actual, target) ?? 0,
    attainmentExpected: percent(expectedLanding, target) ?? 0
  };

  const risk = {
    totalDeals: visibleRiskDeals.length,
    criticalDeals: visibleRiskDeals.filter((deal) => deal.band === 'critical').length,
    highDeals: visibleRiskDeals.filter((deal) => deal.band === 'high').length,
    mediumDeals: visibleRiskDeals.filter((deal) => deal.band === 'medium').length,
    lowDeals: visibleRiskDeals.filter((deal) => deal.band === 'low').length,
    criticalValue: visibleRiskDeals.filter((deal) => deal.band === 'critical').reduce((sum, deal) => sum + deal.amount, 0),
    highValue: visibleRiskDeals.filter((deal) => deal.band === 'high').reduce((sum, deal) => sum + deal.amount, 0),
    totalValueAtRisk: visibleRiskDeals.filter((deal) => deal.score >= 45).reduce((sum, deal) => sum + deal.amount, 0),
    topDeals: visibleRiskDeals.filter((deal) => deal.score >= 25).sort((a, b) => b.score - a.score || b.amount - a.amount).slice(0, 20)
  };

  const callTarget = activityTarget(goals.monthlyCallTarget, filters.days);
  const meetingTarget = activityTarget(goals.monthlyMeetingTarget, filters.days);
  const execution = {
    calls: snapshot.calls,
    meetings: snapshot.meetings,
    callTarget,
    meetingTarget,
    callAttainment: percent(snapshot.calls, callTarget) ?? 0,
    meetingAttainment: percent(snapshot.meetings, meetingTarget) ?? 0,
    meetingRate: snapshot.calls > 0 ? (snapshot.meetings / snapshot.calls) * 100 : 0
  };

  const ownerRows = snapshot.owners.map((row) => {
    const configured = goals.ownerTargets?.[String(row.owner_id)] || {};
    const revenueTarget = activityTarget(configured.revenueTarget || goals.monthlyRevenueTarget, filters.days);
    const ownerCallTarget = activityTarget(configured.callTarget || 0, filters.days);
    const ownerMeetingTarget = activityTarget(configured.meetingTarget || 0, filters.days);
    return {
      ownerId: String(row.owner_id),
      ownerName: row.owner_name,
      wonRevenue: numeric(row.won_revenue),
      calls: numeric(row.calls),
      meetings: numeric(row.meetings),
      revenueTarget,
      callTarget: ownerCallTarget,
      meetingTarget: ownerMeetingTarget,
      revenueAttainment: percent(numeric(row.won_revenue), revenueTarget),
      callAttainment: percent(numeric(row.calls), ownerCallTarget),
      meetingAttainment: percent(numeric(row.meetings), ownerMeetingTarget)
    };
  });
  const quality = { missingOwnerContacts: snapshot.missingOwnerContacts };
  return {
    generatedAt: new Date().toISOString(),
    filters,
    scope,
    goals,
    forecast,
    risk,
    execution,
    quality,
    owners: ownerRows,
    insights: buildInsights({ forecast, risk, execution, quality, owners: ownerRows })
  };
}

export function registerRevenueIntelligenceRoutes(app, { postgres, requireViewer, writeAudit }) {
  const schemaReady = ensureRevenueIntelligenceSchema(postgres);
  const basePath = '/api/v1/customer/workspaces/:workspaceId/intelligence';

  app.get(`${basePath}/scope`, { preHandler: requireViewer }, async (request) => {
    await schemaReady;
    return effectiveOwnerScope(postgres, request, cleanText(request.query?.ownerId));
  });

  app.get(basePath, { preHandler: requireViewer }, async (request) => {
    await schemaReady;
    const scope = await effectiveOwnerScope(postgres, request, cleanText(request.query?.ownerId));
    return buildRevenueIntelligence(postgres, request.params.workspaceId, request.query ?? {}, scope);
  });

  app.patch(`${basePath}/signals/:signalKey/:recordId`, { preHandler: requireViewer }, async (request, reply) => {
    await schemaReady;
    const signalKey = cleanText(request.params.signalKey, 80);
    const recordId = cleanText(request.params.recordId, 160);
    const status = String(request.body?.status ?? 'open').trim().toLowerCase();
    const note = cleanText(request.body?.note, 1000);
    const snoozeDays = Math.max(1, Math.min(90, Math.round(numeric(request.body?.snoozeDays || 7))));
    if (!signalKey || !recordId || !SIGNAL_STATUSES.has(status)) {
      return reply.code(400).send({ error: 'invalid_signal_action', message: 'Choose a valid signal, record and action status.' });
    }
    const result = await postgres.query(`
      INSERT INTO revenue_signal_actions (
        workspace_id, signal_key, record_id, status, snoozed_until, note, updated_by, updated_at
      ) VALUES ($1,$2,$3,$4,CASE WHEN $4='snoozed' THEN NOW()+($5::int*INTERVAL '1 day') ELSE NULL END,$6,$7,NOW())
      ON CONFLICT (workspace_id, signal_key, record_id) DO UPDATE SET
        status=EXCLUDED.status, snoozed_until=EXCLUDED.snoozed_until,
        note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=NOW()
      RETURNING signal_key, record_id, status, snoozed_until, note, updated_at
    `, [request.params.workspaceId, signalKey, recordId, status, snoozeDays, note, request.customer.user.id]);
    await writeAudit(request, {
      workspaceId: request.params.workspaceId,
      actorUserId: request.customer.user.id,
      action: 'revenue.signal_updated',
      targetType: signalKey,
      targetId: recordId,
      metadata: { status, snoozeDays: status === 'snoozed' ? snoozeDays : null, hasNote: Boolean(note) }
    });
    return result.rows[0];
  });
}
