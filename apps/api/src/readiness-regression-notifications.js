import { pathToFileURL } from 'node:url';

import { postgres } from './database.js';
import { getEmailDeliveryConfiguration, sendEmail } from './email-delivery.js';
import { recordBillingUsage } from './billing.js';

const MIGRATION_LOCK = 812341292;
const DEFAULT_LIMIT = 50;
const DEFAULT_STALE_MINUTES = 30;
const MAX_ATTEMPTS = 5;

function safeText(value, max = 1000) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function escapeHtml(value) {
  return safeText(value, 10000)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function normalizeNotificationOptions(input = {}) {
  const limit = Number(input.limit ?? DEFAULT_LIMIT);
  const staleMinutes = Number(input.staleMinutes ?? DEFAULT_STALE_MINUTES);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new TypeError('limit must be an integer between 1 and 200');
  }
  if (!Number.isInteger(staleMinutes) || staleMinutes < 5 || staleMinutes > 1440) {
    throw new TypeError('staleMinutes must be an integer between 5 and 1440');
  }
  return { limit, staleMinutes };
}

export async function ensureReadinessNotificationSchema(db) {
  const client = await db.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${MIGRATION_LOCK})`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS readiness_regression_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id UUID NOT NULL REFERENCES readiness_regression_incidents(id) ON DELETE CASCADE,
        workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        snapshot_id UUID NOT NULL REFERENCES onboarding_readiness_snapshots(id) ON DELETE RESTRICT,
        kind TEXT NOT NULL CHECK (kind IN ('regression','recovery')),
        recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','delivered','failed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        provider TEXT,
        provider_message_id TEXT,
        error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(incident_id, snapshot_id, kind)
      );
      CREATE INDEX IF NOT EXISTS readiness_regression_deliveries_due_idx
        ON readiness_regression_deliveries(next_attempt_at, created_at)
        WHERE status IN ('pending','failed');
      CREATE INDEX IF NOT EXISTS readiness_regression_deliveries_sending_idx
        ON readiness_regression_deliveries(claimed_at, created_at)
        WHERE status='sending';
      CREATE INDEX IF NOT EXISTS readiness_regression_deliveries_workspace_idx
        ON readiness_regression_deliveries(workspace_id, created_at DESC);
    `);
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`).catch(() => undefined);
    client.release();
  }
}

export async function recoverStaleReadinessDeliveries(db, { staleMinutes = DEFAULT_STALE_MINUTES } = {}) {
  const normalized = normalizeNotificationOptions({ limit: 1, staleMinutes });
  const result = await db.query(`
    UPDATE readiness_regression_deliveries
    SET status='failed',
        error='stale_claim_recovered',
        next_attempt_at=NOW(),
        updated_at=NOW()
    WHERE status='sending'
      AND claimed_at IS NOT NULL
      AND claimed_at <= NOW()-($1 || ' minutes')::interval
      AND attempts < ${MAX_ATTEMPTS}
    RETURNING id
  `, [String(normalized.staleMinutes)]);
  return result.rowCount;
}

export async function enqueueReadinessIncidentDeliveries(db) {
  await ensureReadinessNotificationSchema(db);
  const regression = await db.query(`
    INSERT INTO readiness_regression_deliveries(incident_id,workspace_id,snapshot_id,kind)
    SELECT i.id,i.workspace_id,i.latest_snapshot_id,'regression'
    FROM readiness_regression_incidents i
    WHERE i.status IN ('open','acknowledged')
      AND (i.last_notified_at IS NULL OR i.last_notified_at < i.last_detected_at)
    ON CONFLICT (incident_id,snapshot_id,kind) DO NOTHING
    RETURNING id
  `);
  const recovery = await db.query(`
    INSERT INTO readiness_regression_deliveries(incident_id,workspace_id,snapshot_id,kind)
    SELECT i.id,i.workspace_id,i.latest_snapshot_id,'recovery'
    FROM readiness_regression_incidents i
    WHERE i.status='resolved'
    ON CONFLICT (incident_id,snapshot_id,kind) DO NOTHING
    RETURNING id
  `);
  return { regression: regression.rowCount, recovery: recovery.rowCount };
}

export async function claimReadinessDelivery(db) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT d.*,i.severity,i.occurrences,i.first_detected_at,i.last_detected_at,
             w.name AS workspace_name,s.score,s.blockers,s.warnings
      FROM readiness_regression_deliveries d
      JOIN readiness_regression_incidents i ON i.id=d.incident_id
      JOIN workspaces w ON w.id=d.workspace_id
      JOIN onboarding_readiness_snapshots s ON s.id=d.snapshot_id
      WHERE d.status IN ('pending','failed')
        AND d.next_attempt_at <= NOW()
        AND d.attempts < ${MAX_ATTEMPTS}
      ORDER BY d.next_attempt_at,d.created_at
      LIMIT 1
      FOR UPDATE OF d SKIP LOCKED
    `);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return null;
    }
    const row = result.rows[0];
    const recipients = await client.query(`
      SELECT DISTINCT lower(u.email) AS email
      FROM workspace_memberships m
      JOIN app_users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 AND m.role IN ('owner','admin') AND u.status='active'
      ORDER BY email
      LIMIT 20
    `, [row.workspace_id]);
    const emails = recipients.rows.map((item) => item.email).filter(Boolean);
    if (!emails.length) {
      await client.query(`
        UPDATE readiness_regression_deliveries
        SET status='failed',attempts=attempts+1,error='no_active_owner_or_admin_recipient',
            next_attempt_at=NOW()+INTERVAL '24 hours',updated_at=NOW()
        WHERE id=$1
      `, [row.id]);
      await client.query('COMMIT');
      return { ...row, skipped: true, recipients: [] };
    }
    await client.query(`
      UPDATE readiness_regression_deliveries
      SET status='sending',attempts=attempts+1,claimed_at=NOW(),recipients=$2::jsonb,error=NULL,updated_at=NOW()
      WHERE id=$1
    `, [row.id, JSON.stringify(emails)]);
    await client.query('COMMIT');
    return { ...row, recipients: emails };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function buildReadinessIncidentMessage(delivery, appUrl) {
  const recovery = delivery.kind === 'recovery';
  const workspace = safeText(delivery.workspace_name, 120) || 'Workspace';
  const securityUrl = `${String(appUrl || '').replace(/\/$/, '')}/settings/readiness?workspaceId=${encodeURIComponent(delivery.workspace_id)}`;
  const subject = recovery
    ? `Recovered · ${workspace} onboarding readiness`
    : `Action required · ${workspace} readiness regressed`;
  const summary = recovery
    ? `The workspace returned to production-ready status with a score of ${Number(delivery.score || 0)}.`
    : `The workspace moved from ready to blocked with ${Number(delivery.blockers || 0)} blocker(s), ${Number(delivery.warnings || 0)} warning(s), and a score of ${Number(delivery.score || 0)}.`;
  const text = `${subject}\n\n${summary}\n\nReview readiness: ${securityUrl}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17332f"><div style="max-width:620px;margin:0 auto;padding:32px 16px"><div style="background:#fff;border:1px solid #dce8e5;border-radius:18px;padding:28px"><div style="font-size:12px;letter-spacing:.12em;color:#52746e;font-weight:700">${escapeHtml(workspace.toUpperCase())}</div><h1 style="font-size:25px;margin:12px 0 8px">${recovery ? 'Readiness recovered' : 'Readiness regression detected'}</h1><p style="color:#52746e;line-height:1.6">${escapeHtml(summary)}</p><a href="${escapeHtml(securityUrl)}" style="display:inline-block;margin-top:16px;color:#087f68;font-weight:700">Review onboarding readiness</a></div></div></body></html>`;
  return { subject, text, html };
}

async function markFailure(db, delivery, error) {
  const delayMinutes = Math.min(1440, 5 * 2 ** Math.max(0, Number(delivery.attempts || 0)));
  await db.query(`
    UPDATE readiness_regression_deliveries
    SET status='failed',provider=$2,error=$3,next_attempt_at=NOW()+($4 || ' minutes')::interval,updated_at=NOW()
    WHERE id=$1 AND workspace_id=$5 AND status='sending'
  `, [delivery.id, delivery.provider || null, safeText(error.message, 1000), String(delayMinutes), delivery.workspace_id]);
}

export async function deliverReadinessNotification(db, delivery, {
  env = process.env,
  fetchImpl = fetch,
  appUrl = env.APP_URL || 'http://localhost:3210'
} = {}) {
  if (delivery.skipped) return { delivered: false, skipped: true };
  const config = getEmailDeliveryConfiguration(env);
  try {
    const message = buildReadinessIncidentMessage(delivery, appUrl);
    const result = await sendEmail(config, {
      ...message,
      recipients: delivery.recipients,
      attachment: null,
      idempotencyKey: `readiness-${delivery.kind}-${String(delivery.id).replaceAll('-', '')}`
    }, fetchImpl);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`
        UPDATE readiness_regression_deliveries
        SET status='delivered',provider=$2,provider_message_id=$3,delivered_at=NOW(),error=NULL,updated_at=NOW()
        WHERE id=$1 AND workspace_id=$4 AND status='sending'
        RETURNING incident_id,kind
      `, [delivery.id, config.provider, result.providerMessageId, delivery.workspace_id]);
      if (updated.rowCount && delivery.kind === 'regression') {
        await client.query(`UPDATE readiness_regression_incidents SET last_notified_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2`, [delivery.incident_id, delivery.workspace_id]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await recordBillingUsage(db, delivery.workspace_id, 'alert_deliveries', 1);
    return { delivered: true, provider: config.provider, kind: delivery.kind };
  } catch (error) {
    await markFailure(db, { ...delivery, provider: config.provider }, error);
    return { delivered: false, error: safeText(error.message, 1000), kind: delivery.kind };
  }
}

export async function processReadinessNotifications(db, options = {}) {
  const normalized = normalizeNotificationOptions(options);
  await ensureReadinessNotificationSchema(db);
  const recovered = await recoverStaleReadinessDeliveries(db, normalized);
  const enqueued = await enqueueReadinessIncidentDeliveries(db);
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  for (let index = 0; index < normalized.limit; index += 1) {
    const delivery = await claimReadinessDelivery(db);
    if (!delivery) break;
    const result = await deliverReadinessNotification(db, delivery, options);
    if (result.delivered) delivered += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }
  return { recovered, enqueued, delivered, failed, skipped };
}

async function main() {
  const limitIndex = process.argv.indexOf('--limit');
  const staleIndex = process.argv.indexOf('--stale-minutes');
  const limit = limitIndex >= 0 ? process.argv[limitIndex + 1] : undefined;
  const staleMinutes = staleIndex >= 0 ? process.argv[staleIndex + 1] : undefined;
  try {
    process.stdout.write(`${JSON.stringify(await processReadinessNotifications(postgres, { limit, staleMinutes }), null, 2)}\n`);
  } finally {
    await postgres.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ error: safeText(error.message, 1000) })}\n`);
    process.exitCode = 4;
  });
}
