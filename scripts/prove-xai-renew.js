#!/usr/bin/env node
'use strict';

// Behavior proof for the gateway's subscription login renewal. Runs gw-lite.js
// against a local stand-in for the vendor. No live login, no real token.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLIENT = 'stand-in-client';
const GW = path.join(__dirname, '..', 'server', 'gw-lite.js');

function idToken() {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return part({ alg: 'none' }) + '.' + part({ aud: CLIENT }) + '.x';
}

function stamp(ms) {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z');
}

function login(over) {
  return Object.assign({
    access_token: 'old-access-' + 'a'.repeat(24),
    refresh_token: 'old-refresh-1',
    id_token: idToken(),
    expired: stamp(Date.now() - 60000),
    type: 'xai'
  }, over || {});
}

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function call(port, method, body) {
  return new Promise((resolve, reject) => {
    const raw = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/channels', method,
      headers: raw ? { 'content-type': 'application/json', 'content-length': raw.length } : {}
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, obj: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(raw || undefined);
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-xai-renew-'));
  // One person with one live gateway token, for the usage ledger.
  fs.writeFileSync(path.join(root, 'roster.json'), JSON.stringify({ people: [{ login: 'zhang', pid: 'p-zhang' }] }));
  fs.writeFileSync(path.join(root, 'gw-tokens.json'), JSON.stringify({ tokens: [{ pid: 'p-zhang', token: 'dsh_zhangtoken', revoked_at: '' }] }));
  const oauth = path.join(root, 'xai-account.json');
  const vendor = { renewals: [], renewStatus: 200, bearer: [], chats: [], probes: [] };

  const up = await listen((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.url === '/oauth2/token') {
        const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8')));
        vendor.renewals.push(form);
        if (vendor.renewStatus !== 200) {
          res.writeHead(vendor.renewStatus, { 'content-type': 'application/json' });
          res.end('{"error":"invalid_grant"}');
          return;
        }
        const n = vendor.renewals.length;
        // Slow on purpose, so overlapping callers really overlap.
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            access_token: 'new-access-' + n + '-' + 'b'.repeat(24),
            refresh_token: 'new-refresh-' + n,
            expires_in: 21600
          }));
        }, 150);
        return;
      }
      vendor.bearer.push(req.headers.authorization || '');
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        const ask = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const probe = ask.max_tokens === 1;
        (probe ? vendor.probes : vendor.chats).push(ask);
        // Four kinds of model: served on the priority tier, served but only on
        // the default tier, refusing chat altogether, and failing for a reason
        // that says nothing about the model.
        if (ask.model === 'grok-nochat') { res.statusCode = 400; res.end('"not allowed on chat completions"'); return; }
        if (ask.model === 'grok-flaky') { res.statusCode = 503; res.end('{}'); return; }
        // Only the first model takes a picture.
        if (Array.isArray(ask.messages[0] && ask.messages[0].content) && ask.model !== 'grok-stand-in') {
          res.statusCode = 400;
          // "This picture is unusable" is not "this model takes no pictures":
          // the first must leave the question open, the second closes it.
          res.end(ask.model === 'grok-flaky' ? '{"code":"invalid_image"}' : '"image input not supported"');
          return;
        }
        if (ask.model === 'grok-usage') {
          // A streamed answer whose last chunk carries the token counts.
          res.setHeader('content-type', 'text/event-stream');
          res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'hi' } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 340, prompt_tokens_details: { cached_tokens: 1000 }, completion_tokens_details: { reasoning_tokens: 200 } } }) + '\n\n');
          res.end('data: [DONE]\n\n');
          return;
        }
        if (ask.model === 'grok-think') {
          // Thinking summaries as the vendor sends them: one whole summary per event.
          res.setHeader('content-type', 'text/event-stream');
          const ev = (delta) => res.write('data: ' + JSON.stringify({ id: 'x', choices: [{ index: 0, delta }] }) + '\n\n');
          ev({ role: 'assistant', reasoning_content: 'Comparing database' });
          ev({ reasoning_content: ' and object storage' });
          ev({ reasoning_content: ' for images.' });
          ev({ reasoning_content: '\n\n正在梳理数据库存储图片的利弊。' });
          ev({ reasoning_content: '\n\nThird summary, in English.' });
          ev({ content: '结论' });
          res.end('data: [DONE]\n\n');
          return;
        }
        if (ask.stream === true) {
          // A streamed answer in two parts with a pause between them.
          res.setHeader('content-type', 'text/event-stream');
          res.write('data: {"part":1}\n\n');
          setTimeout(() => res.end('data: {"part":2}\n\n'), 600);
          return;
        }
        const tier = ask.model === 'grok-plain' ? 'default' : (ask.service_tier || 'default');
        res.end(JSON.stringify({ service_tier: tier }));
        return;
      }
      res.end(JSON.stringify({ data: [
        { id: 'grok-stand-in', capabilities: { reasoning_effort: ['none', 'low', 'high'] } },
        { id: 'grok-plain' },
        { id: 'grok-nochat' },
        { id: 'grok-flaky' },
        { id: 'grok-imagine-x' }
      ] }));
    });
  });
  const upPort = up.address().port;

  const probe = await listen(() => {});
  const gwPort = probe.address().port;
  await new Promise((r) => probe.close(r));

  const gw = spawn(process.execPath, [GW], {
    env: Object.assign({}, process.env, {
      TDH_ROOT: root,
      TDH_GW_TOKENS: path.join(root, 'gw-tokens.json'),
      TDH_ROSTER: path.join(root, 'roster.json'),
      TDH_USAGE_DIR: path.join(root, 'usage'),
      TDH_GW_ENV: path.join(root, 'gateway.env'),
      TDH_CHANNELS: path.join(root, 'channels.json'),
      TDH_XAI_OAUTH: oauth,
      TDH_GROK_FAST: path.join(root, 'grok-fast.json'),
      TDH_XAI_TOKEN_URL: 'http://127.0.0.1:' + upPort + '/oauth2/token',
      TDH_XAI_BASE: 'http://127.0.0.1:' + upPort,
      TDH_GW_PORT: String(gwPort)
    }),
    stdio: ['ignore', 'pipe', 'inherit']
  });
  await new Promise((resolve, reject) => {
    gw.stdout.on('data', (c) => { if (String(c).indexOf('LISTEN=') >= 0) resolve(); });
    gw.on('exit', (code) => reject(new Error('gateway-exited-' + code)));
  });

  const list = () => call(gwPort, 'POST', { action: 'list-models', vendor: 'grok' });
  const grok = async () => (await call(gwPort, 'GET')).obj.subscriptions.find((s) => s.id === 'grok');

  try {
    // 1. A login that is still good is used as is.
    fs.writeFileSync(oauth, JSON.stringify(login({ expired: stamp(Date.now() + 3600000) })));
    assert.equal((await grok()).bound, true);
    let out = await list();
    assert.equal(out.status, 200);
    assert.equal(out.obj.models[0].id, 'grok-stand-in');
    assert.equal(vendor.renewals.length, 0, 'a fresh login must not be renewed');

    // 1b. Fast is the priority service tier, chosen per model. It is offered on
    //     every model, kept apart from the "none" reasoning level, and only
    //     added to a request when the caller did not pick a tier itself.
    //     Whether a model takes it is learned by asking that model once, never
    //     assumed from its name; a model that refuses chat is not listed.
    assert.deepEqual(out.obj.models, [
      { id: 'grok-stand-in', efforts: ['none', 'low', 'high'], fast: true, fastOn: false, image: true },
      { id: 'grok-plain', efforts: [], fast: false, fastOn: false, image: false },
      { id: 'grok-flaky', efforts: [], fast: false, fastOn: false, image: false }
    ]);
    const asked = vendor.probes.length;
    await list();
    assert.equal(vendor.probes.filter((q) => q.model === 'grok-stand-in').length, 2, 'a model with an answer is not asked again');
    assert.ok(vendor.probes.length > asked && vendor.probes.slice(asked).every((q) => q.model === 'grok-flaky'), 'only the one with no answer is asked again');
    const chat = (body) => new Promise((resolve, reject) => {
      const raw = Buffer.from(JSON.stringify(body));
      const req = http.request({ hostname: '127.0.0.1', port: gwPort, path: '/v1/chat/completions', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': raw.length } }, (r) => { r.resume(); r.on('end', resolve); });
      req.on('error', reject);
      req.end(raw);
    });
    await chat({ model: 'grok-stand-in', messages: [] });
    assert.equal('service_tier' in vendor.chats[0], false, 'not marked fast: request is untouched');
    let set = await call(gwPort, 'POST', { action: 'set-fast', vendor: 'grok', models: ['grok-stand-in', 'bad id', 'grok-stand-in', 'grok-plain'] });
    assert.deepEqual(set.obj.models, ['grok-stand-in', 'grok-plain']);
    await chat({ model: 'grok-plain', messages: [] });
    assert.equal('service_tier' in vendor.chats.pop(), false, 'marked fast but not served on that tier: left alone');
    assert.equal((await list()).obj.models[0].fastOn, true);
    await chat({ model: 'grok-stand-in', messages: [] });
    assert.equal(vendor.chats[1].service_tier, 'priority');
    await chat({ model: 'grok-stand-in', service_tier: 'default', messages: [] });
    assert.equal(vendor.chats[2].service_tier, 'default', "the caller's own tier wins");
    await chat({ model: 'grok-other', messages: [] });
    assert.equal('service_tier' in vendor.chats[3], false, 'other models are untouched');
    set = await call(gwPort, 'POST', { action: 'set-fast', vendor: 'grok', models: [] });
    await chat({ model: 'grok-stand-in', messages: [] });
    assert.equal('service_tier' in vendor.chats[4], false, 'unmarking takes effect on the next request');
    assert.equal((await call(gwPort, 'POST', { action: 'apply-models', vendor: 'grok', models: [] })).obj.error, 'desk-side');

    // 1c. A streamed answer is passed on as it arrives. Held back until it was
    //     complete, the first part and the last reach the caller together and
    //     the person waits the whole generation for the first word.
    const streamed = await new Promise((resolve, reject) => {
      const raw = Buffer.from(JSON.stringify({ model: 'grok-stand-in', stream: true, messages: [] }));
      const at = [];
      const t0 = Date.now();
      const req = http.request({ hostname: '127.0.0.1', port: gwPort, path: '/v1/chat/completions', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': raw.length } }, (r) => {
        r.on('data', () => at.push(Date.now() - t0));
        r.on('end', () => resolve({ at, type: r.headers['content-type'] }));
      });
      req.on('error', reject);
      req.end(raw);
    });
    assert.match(String(streamed.type), /text\/event-stream/);
    assert.ok(streamed.at.length >= 2, 'the two parts arrive separately');
    assert.ok(streamed.at[streamed.at.length - 1] - streamed.at[0] >= 400, 'the first part arrives well before the last');

    // 1d. Thinking summaries reach the desk exactly as the vendor sent them:
    //     the gateway does not rewrite, translate, or re-order them, and makes
    //     no extra vendor call for them.
    const chatsBefore = vendor.chats.length;
    const thought = await new Promise((resolve, reject) => {
      const raw = Buffer.from(JSON.stringify({ model: 'grok-think', stream: true, messages: [] }));
      let text = '';
      const req = http.request({ hostname: '127.0.0.1', port: gwPort, path: '/v1/chat/completions', method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': raw.length } }, (r) => {
        r.on('data', (c) => { text += c; });
        r.on('end', () => resolve(text));
      });
      req.on('error', reject);
      req.end(raw);
    });
    const deltas = thought.split('\n\n').filter((x) => x.startsWith('data: {')).map((x) => JSON.parse(x.slice(6)).choices[0].delta);
    assert.deepEqual(deltas.map((d) => d.reasoning_content || d.content), [
      'Comparing database',
      ' and object storage',
      ' for images.',
      '\n\n正在梳理数据库存储图片的利弊。',
      '\n\nThird summary, in English.',
      '结论'
    ], 'every event passes through untouched and in order');
    assert.equal(deltas[0].role, 'assistant');
    assert.equal(vendor.chats.length, chatsBefore + 1, 'one vendor call for one question, nothing extra');
    assert.ok(/data: \[DONE\]/.test(thought));

    // 1e. Token counts land in the usage ledger under the person whose gateway
    //     token made the call; an unknown caller is kept as "unknown".
    const ask = (token) => new Promise((resolve, reject) => {
      const raw = Buffer.from(JSON.stringify({ model: 'grok-usage', stream: true, messages: [] }));
      const headers = { 'content-type': 'application/json', 'content-length': raw.length };
      if (token) headers.authorization = 'Bearer ' + token;
      const req = http.request({ hostname: '127.0.0.1', port: gwPort, path: '/v1/chat/completions', method: 'POST', headers }, (r) => {
        r.resume();
        r.on('end', resolve);
      });
      req.on('error', reject);
      req.end(raw);
    });
    await ask('dsh_zhangtoken');
    await ask('');
    await new Promise((r) => setTimeout(r, 200));
    const ledgerFiles = fs.readdirSync(path.join(root, 'usage'));
    assert.equal(ledgerFiles.length, 1);
    const lines = fs.readFileSync(path.join(root, 'usage', ledgerFiles[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.login, l.model, l.input, l.output, l.cached, l.reasoning]), [
      ['zhang', 'grok-usage', 1200, 340, 1000, 200],
      ['unknown', 'grok-usage', 1200, 340, 1000, 200]
    ]);
    assert.ok(!('messages' in lines[0]) && !('content' in lines[0]), 'no prompt or answer text is kept');

    // 2. A lapsed login is renewed once, with its own client id, and the
    //    rotated refresh token is on disk afterwards.
    fs.writeFileSync(oauth, JSON.stringify(login()));
    assert.equal((await grok()).bound, true, 'lapsed but renewable still counts as signed in');
    vendor.bearer.length = 0;
    out = await list();
    assert.equal(out.status, 200);
    assert.equal(vendor.renewals.length, 1);
    assert.deepEqual(vendor.renewals[0], { grant_type: 'refresh_token', client_id: CLIENT, refresh_token: 'old-refresh-1' });
    assert.match(vendor.bearer[0], /^Bearer new-access-1-/, 'the request after renewal carries the new token');
    let disk = JSON.parse(fs.readFileSync(oauth, 'utf8'));
    assert.equal(disk.refresh_token, 'new-refresh-1');
    assert.match(disk.access_token, /^new-access-1-/);
    assert.ok(Date.parse(disk.expired) - Date.now() > 5 * 3600000, 'expiry moves forward by the granted lifetime');
    assert.equal(disk.type, 'xai', 'fields the vendor did not return are kept');

    // 3. Callers that arrive together share one renewal. Two renewals would
    //    present the same refresh token twice and the vendor retires it.
    fs.writeFileSync(oauth, JSON.stringify(login({ refresh_token: 'old-refresh-2' })));
    const many = await Promise.all([list(), list(), list(), list(), list()]);
    assert.ok(many.every((r) => r.status === 200));
    assert.equal(vendor.renewals.length, 2, 'five overlapping callers renew once');
    assert.equal(vendor.renewals[1].refresh_token, 'old-refresh-2');

    // 4. A refused renewal leaves the file alone and reports signed-out
    //    instead of sending a dead token upstream.
    const lapsed = JSON.stringify(login({ refresh_token: 'old-refresh-3' }));
    fs.writeFileSync(oauth, lapsed);
    vendor.renewStatus = 400;
    vendor.bearer.length = 0;
    out = await list();
    assert.equal(out.status, 400);
    assert.equal(out.obj.error, 'login-not-installed');
    assert.equal(vendor.bearer.length, 0, 'no model request goes out on a dead login');
    assert.equal(fs.readFileSync(oauth, 'utf8'), lapsed);
    vendor.renewStatus = 200;

    // 5. Lapsed with nothing to renew with is plainly signed out.
    const bare = login();
    delete bare.refresh_token;
    fs.writeFileSync(oauth, JSON.stringify(bare));
    assert.equal((await grok()).bound, false);
    const before = vendor.renewals.length;
    assert.equal((await list()).status, 400);
    assert.equal(vendor.renewals.length, before);

    // 6. No login file at all.
    fs.rmSync(oauth);
    assert.equal((await grok()).bound, false);
  } finally {
    gw.kill();
    up.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.stdout.write('XAI_RENEW_PROVE_OK=1\n');
}

main().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
