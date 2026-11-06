#!/usr/bin/env node
'use strict';

// Behavior proof for per-channel lists: an admin limits a custom channel (a model
// deployed on the company's own GPUs, behind an OpenAI-compatible address) to named
// people. Runs gw-lite.js against two local stand-ins: the "local deployment" and an
// "official DeepSeek" key whose model names overlap. Made-up tokens, no vendor call.
//
// Proves: an empty list serves everyone; only an admin sets a list, and only of known
// logins on a custom channel; a person on the list calls and sees the model; a person off
// the list gets 403 and does not see it (and the call never reaches either upstream: a
// limited model does not fall through to a vendor key of a similar name); the service
// token and a key replacement are not affected; an empty list opens it again.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');
const LOCAL_MODEL = 'deepseek-v4.1-flash-1017';
const RESTRICTED_TEXT = /这个模型只开放给名单上的同事/;

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

// A stand-in OpenAI-compatible upstream that remembers what reached it.
async function upstream(name, models) {
  const seen = [];
  const srv = await listen((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { body = {}; }
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && /\/models$/.test(req.url)) {
        res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
        return;
      }
      seen.push({ url: req.url, model: body.model || '', auth: req.headers.authorization || '' });
      res.end(JSON.stringify({ id: name, choices: [{ message: { role: 'assistant', content: name } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }));
    });
  });
  return { srv, seen, base: 'http://127.0.0.1:' + srv.address().port + '/v1' };
}

async function startGateway(root, port) {
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
      TDH_COMPANY_CA: path.join(root, 'company-ca.crt'),
      TDH_GW_LEGACY: path.join(root, 'gw-legacy.json'),
      TDH_GW_LEGACY_FLUSH_MS: '200',
      TDH_GW_TRUST_LOOPBACK: ''
    }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  const log = [];
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { log.push(String(c)); if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });
  gw.stdout.on('data', (c) => log.push(String(c)));
  gw.logText = () => log.join('');
  return gw;
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-model-allow-'));
  const boss = tok();
  const amy = tok();
  const bob = tok();
  const off = tok();
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [
    { pid: 'p0', login: 'boss', role: 'admin', status: 'active' },
    { pid: 'p1', login: 'amy', role: 'employee', status: 'active' },
    { pid: 'p2', login: 'bob', role: 'employee', status: 'active' },
    { pid: 'p3', login: 'carl', role: 'employee', status: 'disabled' }
  ] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [
    { pid: 'p0', token: boss, revoked_at: '' },
    { pid: 'p1', token: amy, revoked_at: '' },
    { pid: 'p2', token: bob, revoked_at: '' },
    { pid: 'p3', token: off, revoked_at: '' }
  ] }));

  const local = await upstream('local', []);
  // The official key lists a model whose name the local one only resembles.
  const official = await upstream('official', ['deepseek-chat', 'deepseek-v4-flash']);
  const envFile = path.join(root, 'gateway.env');
  const baseEnv = 'DEEPSEEK_API_KEY=stand-in-official-key\nDEEPSEEK_BASE_URL=' + official.base + '\nDEFAULT_MODEL=' + LOCAL_MODEL + '\n';
  fs.writeFileSync(envFile, baseEnv);
  const chanFile = path.join(root, 'channels.json');

  const port = await freePort();
  const gw = await startGateway(root, port);
  const bearer = (t) => ({ authorization: 'Bearer ' + t });
  const chat = (headers, model) => call(port, 'POST', '/v1/chat/completions', headers, { model: model || LOCAL_MODEL, messages: [{ role: 'user', content: 'hi' }] });
  const listed = async (headers) => {
    const r = await call(port, 'GET', '/v1/company-models', headers);
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    return { ids: r.obj.models.map((m) => m.id), def: r.obj.default && r.obj.default.model };
  };
  const setAllow = (headers, id, allow) => call(port, 'POST', '/channels', headers, { action: 'set-allow', id, allow });
  const svc = () => fs.readFileSync(path.join(root, 'gw-service.token'), 'utf8').trim();

  try {
    // 0. The admin adds the local deployment as a custom channel (Settings > 模型).
    let r = await call(port, 'POST', '/channels', bearer(boss), { action: 'add-key', id: 'local', up: local.base, models: LOCAL_MODEL, key: 'stand-in-local-key' });
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    r = await call(port, 'POST', '/channels', bearer(boss), { action: 'add-key', preset: 'kimi', key: 'stand-in-kimi-key' });
    assert.equal(r.status, 200, 'a preset channel too, to prove lists stay on custom channels');
    assert.match(fs.readFileSync(envFile, 'utf8'), /^KEY_LOCAL=stand-in-local-key$/m);

    // 1. No list: everyone sees and calls it (the behaviour before lists).
    for (const [who, t] of [['amy', amy], ['bob', bob]]) {
      const l = await listed(bearer(t));
      assert.ok(l.ids.includes(LOCAL_MODEL), who + ' sees the open channel');
      r = await chat(bearer(t));
      assert.equal(r.status, 200, who + ' calls the open channel: ' + JSON.stringify(r.obj));
      assert.equal(r.obj.id, 'local', 'it is served by the local deployment');
    }
    assert.equal(local.seen.length, 2);
    assert.equal(local.seen[0].auth, 'Bearer stand-in-local-key', 'the local deployment sees its own key, not the desk token');
    console.log('ALLOW_EMPTY_OPEN_OK=1');

    // 2. Only an admin sets a list, only of known logins, only on a custom channel.
    const before = fs.readFileSync(chanFile, 'utf8');
    r = await setAllow({}, 'local', ['amy']);
    assert.equal(r.status, 401, 'no token');
    r = await setAllow(bearer(amy), 'local', ['amy']);
    assert.equal(r.status, 403, 'an employee cannot set a list');
    assert.equal(r.obj.error, 'admin-only');
    r = await setAllow(bearer(svc()), 'local', []);
    assert.equal(r.status, 401, 'the service token cannot set a list');
    r = await setAllow(bearer(boss), 'local', ['amy', 'nobody']);
    assert.equal(r.status, 400, 'an unknown login is refused');
    assert.equal(r.obj.error, 'allow-unknown');
    assert.deepEqual(r.obj.unknown, ['nobody']);
    r = await setAllow(bearer(boss), 'kimi', ['amy']);
    assert.equal(r.status, 400, 'a preset channel has no list');
    assert.equal(r.obj.error, 'allow-custom-only');
    r = await setAllow(bearer(boss), 'nope', ['amy']);
    assert.equal(r.status, 404, 'an unknown channel');
    r = await setAllow(bearer(boss), 'local', 'amy');
    assert.equal(r.status, 400, 'the list must be a list');
    assert.equal(fs.readFileSync(chanFile, 'utf8'), before, 'channels.json untouched by refused calls');
    r = await setAllow(bearer(boss), 'local', [' AMY ', 'amy']);
    assert.equal(r.status, 200, JSON.stringify(r.obj));
    const row = JSON.parse(fs.readFileSync(chanFile, 'utf8')).channels.find((c) => c.id === 'local');
    assert.deepEqual(row.allow, ['amy'], 'stored lower-case, once');
    assert.match(gw.logText(), /GW_ALLOW local by boss -> amy/, 'the change is logged with who made it');
    // A person removed from the roster for good may stay on the list (the page shows them as
    // gone); only a newly added name has to be on the roster.
    const people = JSON.parse(fs.readFileSync(path.join(root, 'roster.json'), 'utf8'));
    people.people.push({ pid: 'p4', login: 'dora', role: 'employee', status: 'active' });
    fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify(people));
    assert.equal((await setAllow(bearer(boss), 'local', ['amy', 'dora'])).status, 200);
    people.people = people.people.filter((p) => p.login !== 'dora');
    fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify(people));
    r = await setAllow(bearer(boss), 'local', ['amy', 'dora']);
    assert.equal(r.status, 200, 'a name already on the list survives its removal from the roster: ' + JSON.stringify(r.obj));
    r = await setAllow(bearer(boss), 'local', ['amy', 'dora', 'nobody']);
    assert.equal(r.status, 400, 'a new unknown name is still refused');
    r = await setAllow(bearer(boss), 'local', ['amy']);
    assert.equal(r.status, 200);
    console.log('ALLOW_ADMIN_ONLY_OK=1');

    // 3. On the list: sees it (and it stays the default), calls it. No restart needed.
    let l = await listed(bearer(amy));
    assert.ok(l.ids.includes(LOCAL_MODEL), 'amy still sees it');
    assert.equal(l.def, LOCAL_MODEL, 'and keeps it as the site default');
    const n0 = local.seen.length;
    r = await chat(bearer(amy));
    assert.equal(r.status, 200, 'amy calls it');
    assert.equal(local.seen.length, n0 + 1);
    r = await call(port, 'POST', '/v1/responses', bearer(amy), { model: LOCAL_MODEL, input: 'hi' });
    assert.equal(r.status, 200, 'amy through the Responses door too');
    console.log('ALLOW_LISTED_OK=1');

    // 4. Off the list: does not see it, gets a 403 with the reason, and the call reaches
    //    neither the local deployment nor the official key. Everything else still works.
    l = await listed(bearer(bob));
    assert.ok(!l.ids.includes(LOCAL_MODEL), 'bob does not see it');
    assert.ok(l.ids.includes('deepseek-chat'), 'bob still sees the external models');
    assert.notEqual(l.def, LOCAL_MODEL, 'bob is not defaulted onto a model he cannot use');
    assert.ok(l.ids.includes(l.def), 'bob gets a default he can use');
    const n1 = local.seen.length;
    const o1 = official.seen.length;
    for (const door of ['/v1/chat/completions', '/v1/responses']) {
      r = await call(port, 'POST', door, bearer(bob), { model: LOCAL_MODEL, messages: [], input: 'hi' });
      assert.equal(r.status, 403, 'bob is refused at ' + door);
      assert.equal(r.obj.error.type, 'gateway_model_restricted');
      assert.match(r.obj.error.message, RESTRICTED_TEXT);
    }
    r = await chat(bearer(boss));
    assert.equal(r.status, 403, 'being admin does not put you on a list');
    assert.equal(local.seen.length, n1, 'a refused call never reaches the local deployment');
    assert.equal(official.seen.length, o1, 'nor falls through to the official key');
    r = await chat(bearer(bob), 'deepseek-chat');
    assert.equal(r.status, 200, 'bob calls the external API');
    assert.equal(r.obj.id, 'official');
    assert.match(gw.logText(), /GW_DENY 403 restricted deepseek-v4\.1-flash-1017 \(local\) for bob/, 'the refusal is logged with the person');
    console.log('ALLOW_UNLISTED_403_OK=1');

    // 5. Who reads the list: an admin sees the names; others only whether they are on it.
    r = await call(port, 'GET', '/channels', bearer(boss));
    let ch = r.obj.models.find((m) => m.id === 'local');
    assert.deepEqual(ch.allow, ['amy']);
    assert.equal(ch.limited, true);
    assert.equal(ch.custom, true);
    r = await call(port, 'GET', '/channels', bearer(bob));
    ch = r.obj.models.find((m) => m.id === 'local');
    assert.equal(ch.allow, undefined, 'an employee does not read the names');
    assert.equal(ch.limited, true);
    assert.equal(ch.mine, false);
    r = await call(port, 'GET', '/channels', bearer(amy));
    assert.equal(r.obj.models.find((m) => m.id === 'local').mine, true);
    console.log('ALLOW_READ_SCOPE_OK=1');

    // 6. The service token (nightly brain job, deep search) is never held back.
    l = await listed(bearer(svc()));
    assert.ok(l.ids.includes(LOCAL_MODEL), 'the server sees it');
    r = await chat(bearer(svc()));
    assert.equal(r.status, 200, 'the server calls it');
    assert.equal(r.obj.id, 'local');
    console.log('ALLOW_SERVICE_TOKEN_OK=1');

    // 7. The tokenless bridge reaches open channels only; a disabled person nothing.
    const withKeys = fs.readFileSync(envFile, 'utf8');
    fs.writeFileSync(envFile, withKeys + 'GW_ALLOW_TOKENLESS=1\n');
    r = await chat({});
    assert.equal(r.status, 403, "tokenless is nobody on a list: " + JSON.stringify(r.obj));
    r = await chat({}, 'deepseek-chat');
    assert.equal(r.status, 200, 'tokenless still reaches open models with the switch on');
    fs.writeFileSync(envFile, withKeys);
    r = await chat(bearer(off));
    assert.equal(r.status, 401, 'a disabled person stays refused');
    console.log('ALLOW_TOKENLESS_OK=1');

    // 7b. The local key gone from gateway.env (a hand edit, a restore): the list still holds,
    //     and the model name does not slip through to the official DeepSeek key.
    fs.writeFileSync(envFile, withKeys.replace(/^KEY_LOCAL=.*\n/m, ''));
    const o2 = official.seen.length;
    r = await chat(bearer(bob));
    assert.equal(r.status, 403, 'still refused without the channel key: ' + JSON.stringify(r.obj));
    assert.equal(official.seen.length, o2, 'and never sent to the official key');
    assert.ok(!(await listed(bearer(bob))).ids.includes(LOCAL_MODEL), 'nor listed');
    fs.writeFileSync(envFile, withKeys);
    console.log('ALLOW_NO_FALLTHROUGH_OK=1');

    // 8. Replacing the key (rotation, new model list) keeps the list.
    r = await call(port, 'POST', '/channels', bearer(boss), { action: 'add-key', id: 'local', up: local.base, models: LOCAL_MODEL, key: 'stand-in-local-key-2' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.obj.models.find((m) => m.id === 'local').allow, ['amy'], 'the list survives a key replacement');
    assert.equal((await chat(bearer(bob))).status, 403);
    console.log('ALLOW_KEY_ROTATE_OK=1');

    // 9. An empty list opens it to everyone again, at once.
    r = await setAllow(bearer(boss), 'local', []);
    assert.equal(r.status, 200);
    assert.ok((await listed(bearer(bob))).ids.includes(LOCAL_MODEL), 'bob sees it again');
    r = await chat(bearer(bob));
    assert.equal(r.status, 200, 'bob calls it again');
    assert.equal(r.obj.id, 'local');
    const ledger = fs.readdirSync(path.join(root, 'usage')).map((f) => fs.readFileSync(path.join(root, 'usage', f), 'utf8')).join('');
    assert.match(ledger, /"login":"amy","model":"deepseek-v4\.1-flash-1017","vendor":"local"/, 'usage of the local channel is booked to the person');
    console.log('ALLOW_REOPEN_OK=1');

    console.log('MODEL_ALLOW_PROVE_OK=1');
  } finally {
    gw.kill();
    local.srv.close();
    official.srv.close();
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
