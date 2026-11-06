#!/usr/bin/env node
// The knowledge base's private layer (company/_handbook/_private): who may search it.
// Starts server/people-api.py and server/knowledge-search.js on one throwaway root (roster,
// passwords, tokens, company folder), signs people in through the people API, and has an
// admin keep the list there (设置 → 人员 → 知识库私密层). Proves:
//   - empty list: only admins find it; an employee, a director, another department do not
//   - only an admin changes the list, only with roster logins; the open people list never
//     shows it; each change asks for the share rights to be redone (secure-folders.ps1)
//   - on the list: found, under several wordings and the layer's own synonyms; off the list:
//     nothing under any of them, not by path either, and no token at all is 401
//   - frontmatter still only narrows: visibility boss stays admins-only inside the layer,
//     visibility company does not open it to someone off the list
//   - a change counts from the next question (no restart); a disabled person gets 401; a
//     removed person leaves the list; emptying it leaves admins only
// Prints KB_PRIVATE_PROVE_OK=1. Needs Python 3 (PROVE_PY, else python3 / python).
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SERVER = path.join(__dirname, '..', 'server');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

function post(port, url, token, body) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify(body || {}));
    const headers = { 'content-type': 'application/json', 'content-length': raw.length };
    if (token) headers.authorization = 'Bearer ' + token;
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method: body === undefined ? 'GET' : 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { json = null; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : raw);
  });
}

function waitPort(port) {
  return new Promise((resolve, reject) => {
    const until = Date.now() + 15000;
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.end(); resolve(); });
      s.on('error', () => { if (Date.now() > until) reject(new Error('no-listen-' + port)); else setTimeout(tryOnce, 100); });
    };
    tryOnce();
  });
}

function put(root, rel, text) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

async function main() {
  const py = process.env.PROVE_PY || ['python3', 'python'].find((n) => spawnSync(n, ['--version']).status === 0);
  if (!py) throw new Error('needs python 3 (set PROVE_PY)');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-kb-private-'));
  const runtime = path.join(root, 'runtime');
  const company = path.join(root, 'company');
  const brain = path.join(root, 'brain');
  fs.mkdirSync(path.join(runtime, 'caddy'), { recursive: true });
  fs.mkdirSync(brain, { recursive: true });
  put(runtime, 'roster.json', JSON.stringify({ owner: 'test', people: [{ login: 'tdh', role: 'admin', dept: 'company', status: 'active', pid: 'p-seed' }] }));
  put(runtime, 'caddy/PASSWORDS.txt', 'tdh:seed-pass-123\n');

  // The private layer, a department handbook and the company handbook.
  put(company, '_handbook/_private/薪酬方案.md', '# 薪酬方案\n\n2027 年销售提成比例调整为百分之八，年终奖按季度考核发放。\n');
  put(company, '_handbook/_private/董事会纪要.md', '---\nvisibility: boss\n---\n# 董事会纪要\n\n收购深圳华南工厂的报价上限是三千万。\n');
  put(company, '_handbook/_private/裁员预案.md', '---\nvisibility: company\n---\n# 裁员预案\n\n明年二季度精简售后团队十二人。\n');
  put(company, '_handbook/_private/同义词.txt', '提成 = 佣金, 抽成\n');
  put(company, '_handbook/_company/请假制度.md', '# 请假制度\n\n请假三天以内找直属主管批准。\n');
  const ledger = path.join(root, 'smb-ledger.jsonl');

  const peoplePort = await freePort();
  const kbPort = await freePort();
  const env = { ...process.env, TDH_ROOT: root, TDH_PEOPLE_PORT: String(peoplePort), DSH_LEASE_DIR: path.join(runtime, 'lease'), TDH_SMB_LEDGER: ledger };
  const peopleApi = spawn(py, [path.join(SERVER, 'people-api.py')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let peopleOut = '';
  peopleApi.stdout.on('data', (c) => { peopleOut += String(c); });
  const kb = spawn(process.execPath, [path.join(SERVER, 'knowledge-search.js')], {
    env: { ...process.env, TDH_ROOT: root, TDH_BRAIN: brain, TDH_COMPANY: company, TDH_KNOW_PORT: String(kbPort),
      TDH_ROSTER: path.join(runtime, 'roster.json'), TDH_GW_TOKENS: path.join(runtime, 'gw-tokens.json'),
      TDH_KNOW_LOG: path.join(root, 'kb.log'), TDH_KB_CACHE: path.join(root, 'kb-cache') },
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  try {
    await waitPort(peoplePort);
    await waitPort(kbPort);
    const people = (token, body) => post(peoplePort, '/company/people', token, body);
    const login = async (name, pw) => {
      const r = await post(peoplePort, '/company/login', '', { username: name, password: pw });
      assert.strictEqual(r.status, 200, 'login ' + name + ' ' + JSON.stringify(r.json));
      return r.json.gw_token;
    };
    const tdh = await login('tdh', 'seed-pass-123');
    let r = await people(tdh, { action: 'dept-add', name: '运营部' });
    const ops = r.json.depts.find((d) => d.name === '运营部').id;
    r = await people(tdh, { action: 'dept-add', name: '销售部' });
    const sales = r.json.depts.find((d) => d.name === '销售部').id;
    const staff = [['amy', 'employee', ops], ['ann', 'employee', ops], ['dan', 'director', ops], ['eve', 'employee', sales], ['adm', 'admin', ops]];
    for (const [who, role, dept] of staff) {
      r = await people(tdh, { action: 'add', login: who, password: 'longenough-' + who, role, dept });
      assert.strictEqual(r.status, 200, 'add ' + who + ' ' + JSON.stringify(r.json));
    }
    const tok = { tdh };
    for (const [who] of staff) tok[who] = await login(who, 'longenough-' + who);

    const search = (who, query) => post(kbPort, '/v1/search', tok[who], { route: 'search', query });
    const paths = async (who, query) => {
      const s = await search(who, query);
      assert.strictEqual(s.status, 200, who + ' ' + query + ' ' + JSON.stringify(s.json));
      return s.json.hits.map((h) => h.path);
    };
    const PAY = 'company/_handbook/_private/薪酬方案.md';
    const BOARD = 'company/_handbook/_private/董事会纪要.md';
    const CUTS = 'company/_handbook/_private/裁员预案.md';
    // Ways to ask for what is in the layer: its words, other words, its synonyms, its title.
    const WORDINGS = ['销售提成比例', '提成怎么算', '年终奖怎么发', '薪酬方案', '佣金比例是多少', '抽成', '2027 提成', '裁员', '精简售后团队', '收购报价上限'];
    const sees = async (who, want) => {
      const got = await paths(who, want === PAY ? '销售提成比例' : want === BOARD ? '收购报价上限' : '精简售后团队');
      return got.indexOf(want) >= 0;
    };
    const blind = async (who, why) => {
      for (const q of WORDINGS) {
        const got = await paths(who, q);
        assert.ok(!got.some((p) => p.indexOf('_private') >= 0), why + ': ' + who + ' must not find the private layer with ' + q + ' ' + JSON.stringify(got));
      }
      // Not by naming the file either.
      const named = await post(kbPort, '/v1/search', tok[who], { route: 'search', query: '提成', path: PAY });
      assert.strictEqual(named.json.hits.length, 0, why + ': ' + who + ' by path');
    };

    // 1. A fresh install: empty list, admins only.
    assert.ok(await sees('tdh', PAY), 'the seed admin finds the private layer');
    assert.ok(await sees('adm', PAY), 'another admin too');
    r = await search('tdh', '销售提成比例');
    assert.strictEqual(r.json.hits.find((h) => h.path === PAY).layer, 'private', 'hits say which layer they are from');
    for (const who of ['amy', 'ann', 'dan', 'eve']) await blind(who, 'empty list');
    assert.deepStrictEqual((await paths('amy', '请假几天找谁批')).slice(0, 1), ['company/_handbook/_company/请假制度.md'], 'the shared layer still answers');
    r = await post(kbPort, '/v1/search', '', { route: 'search', query: '销售提成比例' });
    assert.strictEqual(r.status, 401, 'no token');
    assert.strictEqual(r.json.hits.length, 0);
    console.log('KB_PRIVATE_EMPTY_ADMINS_ONLY_OK=1');

    // 2. Only an admin keeps the list, only with roster logins; nobody else reads it.
    const rosterFile = path.join(runtime, 'roster.json');
    const before = fs.readFileSync(rosterFile, 'utf8');
    r = await people('', { action: 'kb-private-set', allow: ['amy'] });
    assert.strictEqual(r.status, 403, 'no token');
    r = await people(tok.amy, { action: 'kb-private-set', allow: ['amy'] });
    assert.strictEqual(r.status, 403, 'an employee cannot put herself on it');
    r = await people(tok.dan, { action: 'kb-private-set', allow: ['dan'] });
    assert.strictEqual(r.status, 403, 'nor a director');
    r = await people(tok.amy, { action: 'kb-private' });
    assert.strictEqual(r.status, 403, 'an employee cannot read the list');
    r = await people(tdh, { action: 'kb-private-set', allow: ['amy', 'nobody'] });
    assert.strictEqual(r.json.error, 'kb-private-unknown');
    assert.deepStrictEqual(r.json.unknown, ['nobody']);
    r = await people(tdh, { action: 'kb-private-set', allow: 'amy' });
    assert.strictEqual(r.json.error, 'kb-private-bad');
    assert.strictEqual(fs.readFileSync(rosterFile, 'utf8'), before, 'refused changes leave the roster alone');
    const asked = () => fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter((l) => /"secure-folders"/.test(l)).length : 0;
    const n0 = asked();
    r = await people(tdh, { action: 'kb-private-set', allow: [' AMY ', 'amy'] });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(r.json.kb_private, ['amy'], 'stored lower-case, once');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(rosterFile, 'utf8')).kb_private, ['amy']);
    assert.ok(asked() > n0, 'the change asks for the share rights to be redone');
    assert.match(peopleOut, /KB_PRIVATE by tdh -> amy/, 'and is logged with who made it');
    r = await post(peoplePort, '/company/people', '', undefined);
    assert.ok(r.json.ok && !('kb_private' in r.json) && !JSON.stringify(r.json).includes('kb_private'), 'the open people list never names it');
    r = await people(tdh, { action: 'kb-private' });
    assert.deepStrictEqual(r.json.kb_private, ['amy'], 'the admin reads it back');
    console.log('KB_PRIVATE_ADMIN_ONLY_OK=1');

    // 3. On the list: found, with other words and the layer's own synonyms.
    assert.ok(await sees('amy', PAY), 'amy finds it');
    for (const q of ['提成怎么算', '年终奖怎么发', '薪酬方案', '佣金比例是多少', '抽成']) {
      assert.ok((await paths('amy', q)).indexOf(PAY) >= 0, 'amy finds it as ' + q);
    }
    // Off the list, same department, her director, another department: nothing.
    for (const who of ['ann', 'dan', 'eve']) await blind(who, 'amy listed');
    console.log('KB_PRIVATE_LISTED_OK=1');

    // 4. Frontmatter only narrows: boss stays admins-only, company opens nothing.
    assert.ok(!(await sees('amy', BOARD)), 'visibility boss inside the layer: not for amy');
    assert.ok(await sees('tdh', BOARD), 'but for admins');
    assert.ok(await sees('amy', CUTS), 'visibility company: amy, who is listed');
    assert.ok(!(await sees('ann', CUTS)), 'visibility company does not open the layer to ann');
    console.log('KB_PRIVATE_FRONTMATTER_NARROWS_OK=1');

    // 5. Changing the list counts from the next question.
    r = await people(tdh, { action: 'kb-private-set', allow: ['ann'] });
    assert.strictEqual(r.status, 200);
    assert.ok(await sees('ann', PAY), 'ann now finds it');
    await blind('amy', 'amy taken off');
    // A disabled person gets nothing at all; a removed one leaves the list.
    r = await people(tdh, { action: 'disable', login: 'ann' });
    assert.strictEqual(r.status, 200);
    r = await search('ann', '销售提成比例');
    assert.strictEqual(r.status, 401, 'disabled: no search');
    r = await people(tdh, { action: 'remove', login: 'ann' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(rosterFile, 'utf8')).kb_private, [], 'a removed person leaves the list');
    console.log('KB_PRIVATE_CHANGE_LIVE_OK=1');

    // 6. Emptied again: admins only.
    r = await people(tdh, { action: 'kb-private-set', allow: ['eve'] });
    assert.ok(await sees('eve', PAY));
    r = await people(tdh, { action: 'kb-private-set', allow: [] });
    assert.deepStrictEqual(r.json.kb_private, []);
    for (const who of ['amy', 'dan', 'eve']) await blind(who, 'emptied');
    assert.ok(await sees('adm', PAY), 'admins still find it');
    console.log('KB_PRIVATE_EMPTIED_OK=1');

    console.log('KB_PRIVATE_PROVE_OK=1');
  } finally {
    peopleApi.kill();
    kb.kill();
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
