import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('has sane defaults', () => {
    const config = loadConfig({});
    assert.equal(config.port, 3000);
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.corsOrigin, null);
    assert.equal(config.webDistPath, null);
    assert.equal(config.tunnelTtlMs, 900_000);
    assert.equal(config.providerApiUrl, 'https://www.tikwm.com/api/');
  });

  it('reads overrides', () => {
    const config = loadConfig({ API_PORT: '9000', CORS_ORIGIN: 'https://a.test/path', TRUST_PROXY: '1', TUNNEL_LIFESPAN: '60' });
    assert.equal(config.port, 9000);
    assert.equal(config.corsOrigin, 'https://a.test');
    assert.equal(config.trustProxy, 1);
    assert.equal(config.tunnelTtlMs, 60_000);
  });

  it('fails loudly on invalid values', () => {
    assert.throws(() => loadConfig({ API_PORT: 'abc' }), /API_PORT/);
    assert.throws(() => loadConfig({ API_PORT: '70000' }), /API_PORT/);
    assert.throws(() => loadConfig({ CORS_ORIGIN: 'nope' }), /CORS_ORIGIN/);
    assert.throws(() => loadConfig({ PROVIDER_API_URL: 'ftp://x' }), /PROVIDER_API_URL/);
  });
});
