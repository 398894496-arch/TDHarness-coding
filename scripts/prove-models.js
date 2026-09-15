#!/usr/bin/env node
'use strict';

// Behavior proof for local OAuth credential recording, custom endpoints, and
// per-model context. No KERNEL_PREFIX, no live vendor login, no company gateway.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parsePastedOAuth, parsePastedOAuthCode, accountIdFromToken, needsRefresh } = require('./lib/oauth-tokens');
const { listProviders, providerSpec } = require('./lib/oauth-providers');
const { LocalOAuth } = require('./lib/oauth-client');
const {
  parseCredentials, dumpCredentials, loadStore, saveStore, setRef, setGrant, publicView, credentialsPath,
} = require('./lib/credentials-store');
const {
  inferModelMeta, openaiCompatUrl, modelsListUrl, mergeDiscoveredModels, normalizeModels,
  discoverUpstreamModels, renderSoloOverlay, fallbackModelsFor,
} = require('./lib/model-meta');
const { customEndpoint, oauthRouteFromCommit, writeOverlay, apiKeyEnvFor } = require('./lib/models-config');

const ACCESS = 'xai-oauth-access-should-never-leak';
const REFRESH = 'xai-oauth-refresh-should-never-leak';
const KEY = 'test-local-key-not-a-vendor-token';

function jwtWithAccount(accountId) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } })).toString('base64url');
  return `${header}.${payload}.x`;
}

function mockFetch(routes) {
  return async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || 'GET').toUpperCase();
    const key = `${method} ${u}`;
    const hit = routes.find((r) => r.method === method && (typeof r.url === 'function' ? r.url(u) : u === r.url || u.startsWith(r.url)));
    if (!hit) return new Response(JSON.stringify({ error: 'not-mocked', key }), { status: 404 });
    const body = typeof init.body === 'string' || init.body == null
      ? String(init.body || '')
      : init.body instanceof URLSearchParams ? init.body.toString() : await new Response(init.body).text();
    return hit.handle({ url: u, method, body, headers: init.headers || {} });
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

{
  const pasted = parsePastedOAuth('good-code#abcSTATE');
  assert.equal(pasted.code, 'good-code');
  assert.equal(pasted.state, 'abcSTATE');
  const fromUrl = parsePastedOAuth('https://console.anthropic.com/oauth/code/callback?code=from-query&state=s1');
  assert.equal(fromUrl.code, 'from-query');
  assert.equal(fromUrl.state, 's1');
  assert.equal(parsePastedOAuthCode('code=xyz'), 'xyz');
  assert.equal(accountIdFromToken(jwtWithAccount('acct-9')), 'acct-9');
  assert.equal(needsRefresh({ refreshToken: 'r', tokenExpiresAt: new Date(Date.now() + 60_000).toISOString() }), true);
  assert.equal(needsRefresh({ refreshToken: 'r', tokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }), false);
}

{
  const ids = listProviders().map((p) => p.id).sort();
  assert.deepEqual(ids, ['chatgpt', 'claude', 'grok']);
  assert.equal(providerSpec('gemini'), null);
  assert.equal(providerSpec('chatgpt').recordKey, 'llm-pi-ai/openai-codex');
  assert.equal(providerSpec('grok').flow, 'device_code');
  assert.equal(providerSpec('claude').flow, 'authorization_code_paste');
}

{
  assert.equal(inferModelMeta('gpt-5.5').contextWindow, 256_000);
  assert.equal(inferModelMeta('deepseek-v4-pro').contextWindow, 1_000_000);
  assert.equal(inferModelMeta('grok-4.6').contextWindow, 256_000);
  assert.equal(openaiCompatUrl('https://llm.example.test', '/models'), 'https://llm.example.test/v1/models');
  assert.equal(openaiCompatUrl('https://api.x.ai/v1', '/models'), 'https://api.x.ai/v1/models');
  assert.equal(modelsListUrl('https://api.x.ai/v1/'), 'https://api.x.ai/v1/models');
  const merged = mergeDiscoveredModels(
    [{ id: 'custom-mini', contextWindow: 32000 }, { id: 'custom-large' }],
    [{ id: 'custom-large', contextWindow: 180000 }],
    { contextWindow: 64000 },
    { contextWindow: 200000 },
  );
  assert.equal(merged.find((m) => m.id === 'custom-mini').contextWindow, 32000);
  assert.equal(merged.find((m) => m.id === 'custom-large').contextWindow, 64000);
  assert.deepEqual(normalizeModels('a, b，a').map((m) => m.id), ['a', 'b']);
  assert.ok(fallbackModelsFor({ id: 'chatgpt' }).some((m) => m.id === 'gpt-5.5'));
}

async function main() {
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-models-'));
try {
  const cred = path.join(root, '.credentials.yaml');
  const overlay = path.join(root, 'solo.yml');

  {
    const doc = { version: 1, refs: { DEEPSEEK_API_KEY: 'placeholder' }, records: {} };
    saveStore(cred, doc);
    const round = loadStore(cred);
    assert.equal(round.refs.DEEPSEEK_API_KEY, 'placeholder');
    setRef(cred, 'OPENAI_API_KEY', KEY);
    setGrant(cred, 'llm-pi-ai/xai', { access: ACCESS, refresh: REFRESH, expires: Date.now() + 3600_000 });
    const view = publicView(loadStore(cred));
    assert.ok(view.refs.includes('OPENAI_API_KEY'));
    assert.equal(view.records.find((r) => r.key === 'llm-pi-ai/xai').hasAccess, true);
    assert.equal(JSON.stringify(view).includes(ACCESS), false);
    assert.equal(JSON.stringify(view).includes(REFRESH), false);
    const dumped = dumpCredentials(loadStore(cred));
    assert.match(dumped, /OPENAI_API_KEY:/);
    assert.equal(parseCredentials(dumped).refs.OPENAI_API_KEY, KEY);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(cred).mode & 0o077, 0);
    }
  }

  {
    const chatgptToken = jwtWithAccount('acct-42');
    const oauth = new LocalOAuth({
      fetchImpl: mockFetch([
        {
          method: 'POST',
          url: providerSpec('chatgpt').deviceUserCodeUrl,
          handle: () => json({ user_code: 'WXYZ-9', device_auth_id: 'dev-auth-1', interval: 0, expires_in: 900 }),
        },
        {
          method: 'POST',
          url: providerSpec('chatgpt').devicePollUrl,
          handle: ({ body }) => {
            assert.match(body, /dev-auth-1/);
            return json({ authorization_code: 'good-code', code_verifier: 'device-verifier' });
          },
        },
        {
          method: 'POST',
          url: providerSpec('chatgpt').tokenUrl,
          handle: ({ body }) => {
            assert.match(body, /grant_type=authorization_code/);
            assert.match(body, /code_verifier=device-verifier/);
            return json({ access_token: chatgptToken, refresh_token: REFRESH, expires_in: 3600 });
          },
        },
      ]),
    });
    const start = await oauth.start('chatgpt', { models: 'gpt-5.5' });
    assert.equal(start.flow, 'device_code');
    assert.equal(start.userCode, 'WXYZ-9');
    const pending = await oauth.status(start.state);
    assert.equal(pending.status, 'authorized');
    assert.ok((pending.models || []).some((m) => m.id === 'gpt-5.5'));
    assert.equal(JSON.stringify(pending).includes(chatgptToken), false);
    await assert.rejects(() => oauth.commit('chatgpt', { state: start.state, models: [] }, { credentialsFile: cred }), /at least one model/);
    const done = await oauth.commit('chatgpt', { state: start.state, models: 'gpt-5.5, gpt-5.5-mini', contextWindow: 128000, maxTokens: 8192 }, { credentialsFile: cred });
    assert.equal(done.status, 'success');
    assert.equal(done.recordKey, 'llm-pi-ai/openai-codex');
    assert.equal(done.models[0].contextWindow, 128000);
    assert.equal(done.models[0].maxTokens, 8192);
    assert.equal(done.models[1].contextWindow, 128000);
    assert.equal(JSON.stringify(done).includes(chatgptToken), false);
    const stored = loadStore(cred).records['llm-pi-ai/openai-codex'];
    assert.equal(stored.payload.access, chatgptToken);
    assert.equal(stored.payload.accountId, 'acct-42');
    const route = oauthRouteFromCommit(done);
    writeOverlay(overlay, [route]);
    const yml = fs.readFileSync(overlay, 'utf8');
    assert.match(yml, /openai-codex:/);
    assert.match(yml, /contextWindow: 128000/);
    assert.equal(yml.includes(chatgptToken), false);
    assert.equal(yml.includes(ACCESS), false);
  }

  {
    const oauth = new LocalOAuth({
      fetchImpl: mockFetch([
        {
          method: 'POST',
          url: providerSpec('claude').tokenUrl,
          handle: ({ body }) => {
            const parsed = JSON.parse(body);
            assert.equal(parsed.grant_type, 'authorization_code');
            assert.equal(parsed.code, 'good-code');
            assert.ok(parsed.code_verifier);
            assert.equal(parsed.redirect_uri, providerSpec('claude').redirectUri);
            return json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 });
          },
        },
        {
          method: 'GET',
          url: (u) => u.includes('/models'),
          handle: () => json({ data: [] }),
        },
      ]),
    });
    const start = await oauth.start('claude', { models: 'claude-opus-4-6' });
    assert.equal(start.flow, 'authorization_code_paste');
    assert.match(start.authorizeUrl, /code_challenge=/);
    assert.match(start.authorizeUrl, /code=true/);
    await assert.rejects(
      () => oauth.complete('claude', { state: start.state, code: `good-code#not-this-session` }),
      /does not match/,
    );
    const authorized = await oauth.complete('claude', { state: start.state, code: `good-code#${start.state}` });
    assert.equal(authorized.status, 'authorized');
    const done = await oauth.commit('claude', { state: start.state, models: ['claude-opus-4-6'] }, { credentialsFile: cred });
    assert.equal(done.status, 'success');
    assert.equal(loadStore(cred).records['llm-pi-ai/anthropic'].payload.access, ACCESS);
    assert.equal(JSON.stringify(done).includes(ACCESS), false);
  }

  {
    const oauth = new LocalOAuth({
      fetchImpl: mockFetch([
        {
          method: 'POST',
          url: providerSpec('grok').deviceUserCodeUrl,
          handle: ({ body }) => {
            assert.match(body, /client_id=/);
            return json({
              device_code: 'dev-1',
              user_code: 'ABCD-1',
              verification_uri: 'https://auth.x.ai/activate',
              interval: 0,
              expires_in: 900,
            });
          },
        },
        {
          method: 'POST',
          url: providerSpec('grok').tokenUrl,
          handle: ({ body }) => {
            if (body.includes('device_code')) {
              assert.match(body, /urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code|urn:ietf:params:oauth:grant-type:device_code/);
              return json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600 });
            }
            return json({ error: 'unexpected' }, 400);
          },
        },
        {
          method: 'GET',
          url: (u) => u.includes('/models'),
          handle: () => json({ data: [{ id: 'grok-4.6', context_window: 256000 }, { id: 'grok-4.6-fast' }] }),
        },
      ]),
    });
    const start = await oauth.start('grok', { models: 'grok-4.6' });
    assert.equal(start.userCode, 'ABCD-1');
    const st = await oauth.status(start.state);
    assert.equal(st.status, 'authorized');
    const done = await oauth.commit('grok', { state: start.state, models: ['grok-4.6'] }, { credentialsFile: cred });
    assert.equal(done.overlayId, 'xai');
    assert.equal(done.models[0].contextWindow, 256000);
  }

  {
    const fakeModels = 'https://llm.example.test/v1/models';
    const result = await customEndpoint({
      label: 'Acme Gateway',
      baseUrl: 'https://llm.example.test/v1',
      credential: KEY,
      models: 'acme-large',
      contextWindow: 123456,
      reasoningEfforts: ['low', 'high'],
      credentialsFile: cred,
      fetchImpl: mockFetch([
        {
          method: 'GET',
          url: fakeModels,
          handle: ({ headers }) => {
            assert.equal(headers.authorization, `Bearer ${KEY}`);
            return json({ data: [{ id: 'acme-large', context_window: 180000 }, { id: 'acme-fast' }] });
          },
        },
      ]),
    });
    assert.equal(result.provider.id, 'custom-acme-gateway');
    assert.equal(result.credentialRef, apiKeyEnvFor('acme-gateway'));
    assert.equal(result.models[0].id, 'acme-large');
    assert.equal(result.models[0].contextWindow, 123456);
    assert.equal(loadStore(cred).refs[result.credentialRef], KEY);
    writeOverlay(overlay, [result.provider]);
    const yml = fs.readFileSync(overlay, 'utf8');
    assert.match(yml, /custom-acme-gateway:/);
    assert.match(yml, /apiKeyEnv: ACME_GATEWAY_API_KEY/);
    assert.match(yml, /defaultContextWindow: 123456/);
    assert.equal(yml.includes(KEY), false);
    await assert.rejects(() => customEndpoint({ label: 'x', baseUrl: 'not-a-url', credentialsFile: cred }), /http\(s\)/);
    await assert.rejects(() => customEndpoint({ label: '', baseUrl: 'https://x.test', credentialsFile: cred }), /name is required/);
  }

  {
    const listed = await discoverUpstreamModels({
      baseUrl: 'https://llm.example.test/v1',
      credential: KEY,
      fetchImpl: async () => json({ data: [{ id: 'foo-1', context_window: 99000 }] }),
    });
    assert.equal(listed.source, 'upstream');
    assert.equal(listed.models[0].contextWindow, 99000);
    const fallback = await discoverUpstreamModels({
      baseUrl: 'https://api.x.ai/v1',
      credential: KEY,
      channel: { id: 'grok' },
      fetchImpl: async () => new Response('no', { status: 401 }),
    });
    assert.equal(fallback.source, 'fallback');
    assert.ok(fallback.models.some((m) => m.id === 'grok-4.6'));
  }

  {
    const text = renderSoloOverlay({ providers: [] });
    assert.match(text, /defaultPreset: workspace-write/);
    assert.doesNotMatch(text, /name: '@deepseek-ai\/dsh-llm-pi-ai'/);
    assert.equal(credentialsPath('/tmp/dsh-home'), path.join('/tmp/dsh-home', '.credentials.yaml'));
  }

  console.log('MODELS_PROVE_OK=1');
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('tdh-models-'));
  fs.rmSync(root, { recursive: true, force: true });
}
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
