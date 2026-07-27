import assert from 'node:assert/strict';
import test from 'node:test';

const ORIGINAL_ENV = { ...process.env };
let importCounter = 0;

async function importConfigWithEnv(nextEnv) {
  process.env = { ...ORIGINAL_ENV, ...nextEnv };
  for (const key of ['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'ADMIN_API_KEY']) {
    if (nextEnv[key] === undefined) delete process.env[key];
  }
  try {
    importCounter += 1;
    return await import(`../src/config.js?runtime-admin-key-test=${importCounter}`);
  } finally {
    process.env = { ...ORIGINAL_ENV };
  }
}

test('runtime configuration requires ADMIN_API_KEY outside development', async () => {
  const { assertRuntimeConfiguration } = await importConfigWithEnv({
    NODE_ENV: 'staging',
    DATABASE_URL: 'postgres://example.local/ops',
    REDIS_URL: 'redis://example.local:6379',
    ADMIN_API_KEY: undefined
  });

  assert.throws(
    () => assertRuntimeConfiguration(),
    /ADMIN_API_KEY is required outside development/
  );
});

test('development runtime can start without ADMIN_API_KEY for local setup', async () => {
  const { assertRuntimeConfiguration } = await importConfigWithEnv({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgres://example.local/ops',
    REDIS_URL: 'redis://example.local:6379',
    ADMIN_API_KEY: undefined
  });

  assert.doesNotThrow(() => assertRuntimeConfiguration());
});

test('production runtime accepts a configured ADMIN_API_KEY', async () => {
  const { assertRuntimeConfiguration } = await importConfigWithEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://example.local/ops',
    REDIS_URL: 'redis://example.local:6379',
    ADMIN_API_KEY: 'configured-admin-key'
  });

  assert.doesNotThrow(() => assertRuntimeConfiguration());
});
