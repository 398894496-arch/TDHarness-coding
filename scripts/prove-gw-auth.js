#!/usr/bin/env node
'use strict';

// Behavior proof for the gateway's access check. Runs gw-lite.js against a
// local stand-in vendor with made-up tokens. No real key, no vendor call.
// The gateway trusts no address, so a local request stands in for a desk. Jobs on
// the server use the service token; TDH_GW_TRUST_LOOPBACK=1 (tests only) restores
// the old trust. Once this server's CA is exported, plaintext from the LAN is refused.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');
const PATCH_PY = path.join(__dirname, '..', 'server', 'site-patches', 'patch_gw_token.py');

const tok = () => 'dsh_' + crypto.randomBytes(12).toString('hex');

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function freePort() {
  const s = await listen(() => {});
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

function call(port, method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const raw = body ? Buffer.from(JSON.stringify(body)) : null;
    const h = Object.assign({}, headers || {});
    if (raw) { h['content-type'] = 'application/json'; h['content-length'] = raw.length; }
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: h }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let obj = null;
        try { obj = JSON.parse(text); } catch (e) { obj = text; }
        resolve({ status: r.statusCode, obj });
      });
    });
    req.on('error', reject);
    req.end(raw || undefined);
  });
}

async function startGateway(root, port, extraEnv) {
  const gw = spawn(process.execPath, [GW], {
    env: Object.assign({}, process.env, {
      TDH_ROOT: root,
      TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'),
      TDH_ROSTER: path.join(root, 'roster.json'),
      TDH_USAGE_DIR: path.join(root, 'usage'),
      TDH_GW_ENV: path.join(root, 'gateway.env'),
      TDH_CHANNELS: path.join(root, 'channels.json'),
      TDH_XAI_OAUTH: path.join(root, 'no-xai-login.json'),
      TDH_GROK_FAST: path.join(root, 'grok-fast.json'),
      TDH_GW_PORT: String(port),
      TDH_GW_SERVICE_TOKEN_FILE: path.join(root, 'gw-service.token'),
      TDH_COMPANY_CA: path.join(root, 'company-ca.crt')
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });
  return gw;
}

function provePatch() {
  // The desk side: every gateway door must send the token, on both platforms.
  const py = ['python3', 'python'].find((n) => spawnSync(n, ['--version']).status === 0);
  if (!py) { console.log('GW_TOKEN_PATCH_SKIPPED=no-python'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-gw-token-patch-'));
  const js = path.join(dir, 'index.js');
  const sh = path.join(dir, 'start.command');
  fs.writeFileSync(js, 'export const name = "x";\n\nfunction tokenOf() {\n  return process.env.DEEPSEEK_API_KEY || "";\n}\n');
  fs.writeFileSync(sh, 'if [ -z "${DEEPSEEK_API_KEY:-}" ]; then\n  DEEPSEEK_API_KEY="$(tr -d \'\\r\\n\' < "$TOKFILE")"\n  export DEEPSEEK_API_KEY\nfi\nexport NO_PROXY=x\n');
  for (let i = 0; i < 2; i++) {
    const r = spawnSync(py, ['-I', PATCH_PY, js, sh], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, i === 0 ? /index\.js patched-gw-token[\s\S]*start\.command patched-gw-token/ : /index\.js already[\s\S]*start\.command already/);
  }
  // The patched tokenOf picks the dsh_ token from either variable.
  const body = fs.readFileSync(js, 'utf8').replace('export const name = "x";', '');
  const pick = (env) => new Function('process', body + '\nreturn tokenOf();')({ env });
  assert.equal(pick({ GROK_API_KEY: 'dsh_win' }), 'dsh_win', 'Windows keeps the token in GROK_API_KEY');
  assert.equal(pick({ DEEPSEEK_API_KEY: 'dsh_mac' }), 'dsh_mac', 'Mac keeps the token in DEEPSEEK_API_KEY');
  assert.equal(pick({ GROK_API_KEY: 'company-gateway', DEEPSEEK_API_KEY: 'sk-official' }), '', 'a non-token value is never sent');
  if (process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0) {
    fs.writeFileSync(path.join(dir, 'tok'), 'dsh_fromfile\n');
    const r = spawnSync('bash', ['-c', 'TOKFILE="$1"; source "$2"; printf %s "$GROK_API_KEY"', '_', path.join(dir, 'tok'), sh], {
      encoding: 'utf8', env: Object.assign({}, process.env, { DEEPSEEK_API_KEY: '', GROK_API_KEY: '' }), cwd: dir
    });
    assert.equal(r.stdout, 'dsh_fromfile', 'Mac exports the login token as GROK_API_KEY too');
  }
  console.log('GW_TOKEN_PATCH_OK=1');
}

async function main() {
  provePatch();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-gw-auth-'));
  const boss = tok();
  const amy = tok();
  const revoked = tok();
  const off = tok();
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [
    { pid: 'p0', login: 'boss', role: 'admin', status: 'active' },
    { pid: 'p1', login: 'amy', role: 'employee', status: 'active' },
    { pid: 'p2', login: 'bob', role: 'admin', status: 'disabled' }
  ] }));
  const tokens = [
    { pid: 'p0', token: boss, revoked_at: '' },
    { pid: 'p1', token: revoked, revoked_at: '2026-10-01T00:00:00' },
    { pid: 'p1', token: amy, revoked_at: '' },
    { pid: 'p2', token: off, revoked_at: '' }
  ];
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens }));

  const seen = [];
  const vendor = await listen((req, res) => {
    req.resume();
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization || '' });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'x', choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    });
  });
  const envFile = path.join(root, 'gateway.env');
  const baseEnv = 'DEEPSEEK_API_KEY=stand-in-vendor-key\nDEEPSEEK_BASE_URL=http://127.0.0.1:' + vendor.address().port + '/v1\n';
  fs.writeFileSync(envFile, baseEnv);

  const port = await freePort();
  const gw = await startGateway(root, port, {});
  const chat = (headers) => call(port, 'POST', '/v1/chat/completions', headers, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }] });
  const bearer = (t) => ({ authorization: 'Bearer ' + t });
  let gw2 = null;
  let gw3 = null;

  try {
    // 1. Model calls need a live token of an active person.
    const deny = [
      ['no token', {}],
      ['name header only', { 'X-Auth-Request-User': 'amy', 'X-Company-Desk': 'amy' }],
      ['made-up token', bearer(tok())],
      ['revoked token', bearer(revoked)],
      ['disabled person', { 'x-company-gw-token': off }],
      ['placeholder key', bearer('company-gateway')]
    ];
    for (const [why, headers] of deny) {
      const r = await chat(headers);
      assert.equal(r.status, 401, why);
      assert.equal(r.obj.error.type, 'gateway_unauthorized', why);
    }
    assert.equal(seen.length, 0, 'a refused call must not reach the vendor');
    let r = await chat(bearer(amy));
    assert.equal(r.status, 200, 'a live token goes through');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].auth, 'Bearer stand-in-vendor-key', 'the vendor sees the server key, not the desk token');
    r = await chat({ 'x-company-gw-token': amy });
    assert.equal(r.status, 200, 'the token header works as well as Bearer');
    const ledger = fs.readdirSync(path.join(root, 'usage')).map((f) => fs.readFileSync(path.join(root, 'usage', f), 'utf8')).join('');
    assert.match(ledger, /"login":"amy"/, 'usage is booked to the person');
    console.log('GW_MODEL_AUTH_OK=1');

    // 2. Search, fetch, images and videos spend company keys too.
    for (const door of ['/search', '/fetch', '/images', '/videos']) {
      r = await call(port, 'POST', door, {}, { query: 'x', url: 'http://127.0.0.1/', prompt: 'x' });
      assert.equal(r.status, 401, door + ' without a token');
      r = await call(port, 'POST', door, bearer(revoked), { query: 'x' });
      assert.equal(r.status, 401, door + ' with a revoked token');
    }
    console.log('GW_TOOL_DOORS_AUTH_OK=1');

    // 3. Keys and channel settings: admins only. Reading what is bound stays open.
    const before = fs.readFileSync(envFile, 'utf8');
    const addKey = { action: 'add-key', id: 'evil', key: 'stand-in-other-key', up: 'http://127.0.0.1:9/v1', models: 'deepseek-chat' };
    r = await call(port, 'POST', '/channels', {}, addKey);
    assert.equal(r.status, 401, 'add-key without a token');
    assert.equal(r.obj.error, 'login');
    r = await call(port, 'POST', '/channels', bearer(amy), addKey);
    assert.equal(r.status, 403, 'add-key by an employee');
    assert.equal(r.obj.error, 'admin-only');
    r = await call(port, 'POST', '/channels', { 'x-company-gw-token': off }, { action: 'drop-key', id: 'deepseek' });
    assert.equal(r.status, 401, 'a disabled admin is nobody');
    r = await call(port, 'POST', '/channels', bearer(amy), { action: 'drop-key', id: 'deepseek' });
    assert.equal(r.status, 403, 'drop-key by an employee');
    assert.equal(fs.readFileSync(envFile, 'utf8'), before, 'gateway.env untouched by refused calls');
    assert.equal(fs.existsSync(path.join(root, 'channels.json')), false, 'channels.json untouched by refused calls');
    r = await call(port, 'POST', '/channels', bearer(boss), { action: 'add-key', preset: 'kimi', key: 'stand-in-kimi-key' });
    assert.equal(r.status, 200, 'an admin can add a key');
    assert.match(fs.readFileSync(envFile, 'utf8'), /^KIMI_API_KEY=stand-in-kimi-key$/m);
    for (const url of ['/health', '/channels', '/grok-quota']) {
      r = await call(port, 'GET', url, {});
      assert.equal(r.status, 200, url + ' stays open');
    }
    assert.doesNotMatch(JSON.stringify((await call(port, 'GET', '/channels', {})).obj), /stand-in/, 'the open read never shows a key');
    console.log('GW_CHANNELS_ADMIN_OK=1');

    // 4. Revoking a token or disabling a person cuts the next call, no restart.
    tokens[2].revoked_at = '2026-10-09T12:00:00';
    fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens }));
    assert.equal((await chat(bearer(amy))).status, 401, 'revoked while the gateway runs');
    const roster = JSON.parse(fs.readFileSync(path.join(root, 'roster.json'), 'utf8'));
    roster.people[0].status = 'disabled';
    fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify(roster));
    assert.equal((await call(port, 'POST', '/channels', bearer(boss), { action: 'drop-key', id: 'kimi' })).status, 401, 'admin disabled while the gateway runs');
    console.log('GW_REVOKE_LIVE_OK=1');

    // 5. Transition switch for desks not yet updated: no token at all passes,
    //    a wrong token still does not, and settings never open up.
    fs.writeFileSync(envFile, fs.readFileSync(envFile, 'utf8') + 'GW_ALLOW_TOKENLESS=1\n');
    const n = seen.length;
    assert.equal((await chat({})).status, 200, 'tokenless passes with the switch on');
    assert.equal(seen.length, n + 1);
    assert.equal((await chat(bearer(revoked))).status, 401, 'a revoked token is refused even with the switch on');
    assert.equal((await call(port, 'POST', '/channels', {}, addKey)).status, 401, 'settings stay admin-only with the switch on');
    console.log('GW_TOKENLESS_SWITCH_OK=1');
    fs.writeFileSync(envFile, baseEnv);

    // 6. No address is trusted: a placeholder key from 127.0.0.1 is refused (that is
    //    what Caddy forwards from, and what a proxy with allow-LAN would forward from).
    //    Jobs on the server use the service token the gateway wrote at start.
    r = await call(port, 'POST', '/v1/chat/completions', bearer('company-gateway'), { model: 'deepseek-chat', messages: [] });
    assert.equal(r.status, 401, 'loopback is not trusted');
    const svc = fs.readFileSync(path.join(root, 'gw-service.token'), 'utf8').trim();
    assert.match(svc, /^svc_[0-9a-f]{48}$/);
    r = await call(port, 'POST', '/v1/chat/completions', bearer(svc), { model: 'deepseek-chat', messages: [] });
    assert.equal(r.status, 200, 'the service token works');
    r = await call(port, 'POST', '/channels', bearer(svc), addKey);
    assert.equal(r.status, 401, 'the service token cannot change keys');
    const ledger2 = fs.readdirSync(path.join(root, 'usage')).map((f) => fs.readFileSync(path.join(root, 'usage', f), 'utf8')).join('');
    assert.match(ledger2, /"login":"server"/, 'service calls are booked to the server');
    const port2 = await freePort();
    gw2 = await startGateway(root, port2, { TDH_GW_TRUST_LOOPBACK: '1' });
    assert.equal(fs.readFileSync(path.join(root, 'gw-service.token'), 'utf8').trim(), svc, 'the service token survives a restart');
    r = await call(port2, 'POST', '/v1/chat/completions', {}, { model: 'deepseek-chat', messages: [] });
    assert.equal(r.status, 200, 'TDH_GW_TRUST_LOOPBACK=1 restores the old trust (tests only)');
    console.log('GW_SERVICE_TOKEN_OK=1');

    // 7. Once the CA is exported, desks come through Caddy (here: 127.0.0.1) and a
    //    request straight from the LAN is plaintext: refused unless GW_PLAIN_LAN=1.
    const lan = Object.values(os.networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal);
    if (!lan) {
      console.log('GW_PLAIN_LAN_SKIPPED=no-lan-address');
    } else {
      fs.writeFileSync(path.join(root, 'company-ca.crt'), '-----BEGIN CERTIFICATE-----\n');
      const amy2 = tok();
      tokens.push({ pid: 'p1', token: amy2, revoked_at: '' });
      fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens }));
      const port3 = await freePort();
      gw3 = await startGateway(root, port3, {});
      const viaLan = (headers) => new Promise((resolve, reject) => {
        const raw = Buffer.from(JSON.stringify({ model: 'deepseek-chat', messages: [] }));
        const req = http.request({ hostname: lan.address, port: port3, path: '/v1/chat/completions', method: 'POST',
          headers: Object.assign({ 'content-type': 'application/json', 'content-length': raw.length }, headers) }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => { let obj = null; try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { obj = null; } resolve({ status: res.statusCode, obj }); });
        });
        req.on('error', reject);
        req.end(raw);
      });
      r = await viaLan(bearer(amy2));
      assert.equal(r.status, 403, 'plaintext from the LAN is refused once TLS is ready');
      assert.equal(r.obj.error.type, 'gateway_plaintext');
      r = await call(port3, 'POST', '/v1/chat/completions', bearer(amy2), { model: 'deepseek-chat', messages: [] });
      assert.equal(r.status, 200, 'the same token through Caddy (loopback) works');
      fs.writeFileSync(envFile, baseEnv + 'GW_PLAIN_LAN=1\n');
      r = await viaLan(bearer(amy2));
      assert.equal(r.status, 200, 'GW_PLAIN_LAN=1 lets plaintext through during the switch');
      r = await viaLan({});
      assert.equal(r.status, 401, 'the bridge never waives the token');
      console.log('GW_PLAIN_LAN_OK=1');
    }

    console.log('GW_AUTH_PROVE_OK=1');
  } finally {
    gw.kill();
    if (gw2) gw2.kill();
    if (gw3) gw3.kill();
    vendor.close();
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
