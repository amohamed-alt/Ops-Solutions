import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadinessRegressionIncident } from '../src/readiness-incident-query.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const incidentId = '22222222-2222-4222-8222-222222222222';

test('queries one readiness incident with workspace and incident scoping', async () => {
  const calls = [];
  const row = { id: incidentId, workspace_id: workspaceId };
  const db = {
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [row] };
    }
  };

  const result = await getReadinessRegressionIncident(db, { workspaceId, incidentId });
  assert.equal(result, row);
  assert.deepEqual(calls[0].values, [workspaceId, incidentId]);
  assert.match(calls[0].sql, /i\.workspace_id=\$1 AND i\.id=\$2/);
  assert.match(calls[0].sql, /LIMIT 1/);
});

test('returns null when the incident does not exist in the workspace', async () => {
  const db = { async query() { return { rows: [] }; } };
  assert.equal(await getReadinessRegressionIncident(db, { workspaceId, incidentId }), null);
});

test('rejects invalid workspace or incident identifiers before querying', async () => {
  let queried = false;
  const db = { async query() { queried = true; return { rows: [] }; } };

  await assert.rejects(
    getReadinessRegressionIncident(db, { workspaceId: 'invalid', incidentId }),
    /workspaceId must be a valid UUID/
  );
  await assert.rejects(
    getReadinessRegressionIncident(db, { workspaceId, incidentId: 'invalid' }),
    /incidentId must be a valid UUID/
  );
  assert.equal(queried, false);
});
