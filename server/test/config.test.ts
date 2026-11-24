import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../config.ts';

describe('loadConfig', () => {
  it('has sane defaults', () => {
    const config = loadConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.isProd, false);
    assert.equal(config.corsOrigin, null);
    assert.equal(config.webDistPath, null);
    assert.equal(config.trustProxy, 1);
    assert.equal(config.upstreamTimeoutMs, 15_000);
  });

  it('reads overrides and production defaults', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      API_PORT: '9000',
      CORS_ORIGIN: 'https://a.test/path',
      TRUST_PROXY: '2',
      UPSTREAM_TIMEOUT: '30',
    });
    assert.equal(config.isProd, true);
    assert.equal(config.port, 9000);
    assert.equal(config.corsOrigin, 'https://a.test');
    assert.equal(config.trustProxy, 2);
    assert.equal(config.webDistPath, 'dist');
    assert.equal(config.upstreamTimeoutMs, 30_000);
  });

  it('fails loudly on invalid values', () => {
    assert.throws(() => loadConfig({ API_PORT: 'abc' }), /API_PORT/);
    assert.throws(() => loadConfig({ API_PORT: '70000' }), /API_PORT/);
    assert.throws(() => loadConfig({ CORS_ORIGIN: 'nope' }), /CORS_ORIGIN/);
  });
});
