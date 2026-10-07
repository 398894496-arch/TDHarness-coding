#!/usr/bin/env node
// Knowledge search answers only a live login token of an active person.
// Starts server/knowledge-search.js on a throwaway brain, roster and token
// store, then asks it as: nobody, a forged name header, a made-up token, a
// revoked token, a disabled person, and a real person.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tok = () => 'dsh_' + crypto.randomBytes(16).toString('hex');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function ask(port, headers, body) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body || { query: '退货' }));
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/v1/search', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': raw.length, ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-know-'));
  const brain = path.join(dir, 'brain');
  fs.mkdirSync(path.join(brain, '11-l1'), { recursive: true });
  fs.writeFileSync(path.join(brain, '11-l1', 'a.md'), '退货流程：先登记再寄回。\n');
  const live = tok();
  const revoked = tok();
  const off = tok();
  fs.writeFileSync(path.join(dir, 'roster.json'), JSON.stringify({ people: [
    { pid: 'p1', login: 'amy', status: 'active' },
    { pid: 'p2', login: 'bob', status: 'disabled' },
  ] }));
  fs.writeFileSync(path.join(dir, 'gw-tokens.json'), JSON.stringify({ tokens: [
    { pid: 'p1', token: revoked, revoked_at: '2026-10-01T00:00:00' },
    { pid: 'p1', token: live, revoked_at: '' },
    { pid: 'p2', token: off, revoked_at: '' },
  ] }));
  const port = await freePort();
  const log = path.join(dir, 'know.log');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_BRAIN: brain, TDH_KNOW_PORT: String(port), TDH_ROSTER: path.join(dir, 'roster.json'),
      TDH_GW_TOKENS: path.join(dir, 'gw-tokens.json'), TDH_KNOW_LOG: log },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { if (String(d).includes('LISTEN=')) resolve(); });
      child.on('exit', (c) => reject(new Error('server-exit ' + c)));
    });
    const deny = [
      ['no token', {}],
      ['name header', { 'X-Auth-Request-User': 'amy', 'X-Company-Desk': 'amy' }],
      ['made-up token', { Authorization: 'Bearer ' + tok() }],
      ['revoked token', { Authorization: 'Bearer ' + revoked }],
      ['disabled person', { 'X-Company-Gw-Token': off }],
    ];
    for (const [why, headers] of deny) {
      const r = await ask(port, headers);
      assert.strictEqual(r.status, 401, why);
      assert.strictEqual(r.json.hits.length, 0, why);
    }
    const ok = await ask(port, { Authorization: 'Bearer ' + live });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.json.login, 'amy');
    assert.strictEqual(ok.json.hits.length, 1);
    const other = await ask(port, { 'X-Company-Gw-Token': live });
    assert.strictEqual(other.status, 200);
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.strictEqual(lines.filter((l) => l.login === 'amy').length, 2);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('退货'), 'log must not keep the question');
    console.log('KNOWLEDGE_AUTH_OK=1');
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
