#!/usr/bin/env node
// Knowledge search: who may ask, what they find, and how well.
// Starts server/knowledge-search.js on a throwaway brain, company folder, roster
// and token store, then asks it as
//   nobody, a forged name header, a made-up token, a revoked token, a disabled person
//     -> 401, nothing
//   an employee, another employee of the same department, their director, someone
//   from another department, an admin
//     -> each finds exactly what their place allows (handbook by department, daily
//        pages up the management line, raw conversations only by path, frontmatter
//        narrowing, 90-system never)
// and checks the ranking: Chinese words found without a dictionary, the snippet is
// the text around the hit with its line, .docx / .xlsx / .pptx are read, .pdf is
// reported as skipped, and paths never carry the server's own folders.
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
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
    const raw = Buffer.from(JSON.stringify(body || { route: 'search', query: '退货' }));
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

// A zip with deflated members (CRC left 0: the reader does not check it).
function zip(members) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const [name, text] of Object.entries(members)) {
    const n = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

function put(root, rel, content) {
  const p = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-know-'));
  const brain = path.join(dir, 'brain');
  const company = path.join(dir, 'company');
  // One long paragraph: the hit sits near its end, far from the top of the file and of the passage.
  const filler = Array.from({ length: 30 }, (_, i) => '第 ' + (i + 1) + ' 条：日常记录，和本题无关。').join('\n');

  // Whole company: a .docx policy, a .pptx deck, company memory, a scanned .pdf.
  put(company, '_handbook/_company/after-sales.docx', zip({
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>售后手册</w:t></w:r></w:p>'
      + '<w:p><w:r><w:t xml:space="preserve">客户申请退货后，</w:t></w:r><w:r><w:t>七天内寄回，运费由公司承担。</w:t></w:r></w:p></w:body></w:document>',
  }));
  put(company, '_handbook/_company/onboarding.pptx', zip({
    'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>入职第一周</a:t></a:r></a:p></p:sld>',
    'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>报销走飞书审批，发票抬头写公司全称</a:t></a:r></a:p></p:sld>',
  }));
  put(company, '_handbook/_company/scan.pdf', '%PDF-1.4 退货');
  put(company, '_shared/_memory/01-projects/pricing.md', '---\nowner: adm\nvisibility: company\n---\n# 报价\n\n' + filler + '\n大客户报价单价 12 元，满一千件九折。\n');
  put(company, '_shared/_memory/01-projects/salary.md', '---\nowner: adm\nvisibility: boss\n---\n# 薪资\n\n退货组的薪资方案只给管理员看。\n');
  // Department handbooks: ops has a warehouse sheet, sales its own page.
  put(company, '_handbook/ops/warehouse.xlsx', zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="退货登记" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>单号</t></si><si><t>原因</t></si><si><t>退货入库</t></si><si><t>破损</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2"><v>1001</v></c><c r="B2" t="s"><v>2</v></c><c r="C2" t="s"><v>3</v></c></row></sheetData></worksheet>',
  }));
  put(company, '_handbook/sales/script.md', '# 销售话术\n\n客户说要退货时，先问原因。\n');
  // Personal memory: amy's own.
  put(company, 'content/emp-amy/_memory/02-methods/note.md', '# 我的记录\n\n退货单我习惯周五统一处理。\n');
  // Brain: amy's daily page and raw conversation, a sales lesson, the system folder.
  put(brain, '11-l1/ops/amy/2026-10-08.md', '---\nowner: amy\ndept: ops\nvisibility: self\nlayer: l1\n---\n# L1 ops / amy\n\n- 要求：整理退货流程｜结果：已发给主管\n');
  put(brain, '10-l0/ops/amy/2026-10/2026-10-08.md', '---\nowner: amy\ndept: ops\nvisibility: self\nlayer: l0\n---\n# L0\n\n## s1\n- fact: 退货流程原话，老板说先登记再寄回\n');
  put(brain, '20-l2/sales/lesson.md', '---\nowner: sales\ndept: sales\nvisibility: dept\n---\n# 退货话术复盘\n\n退货客户先安抚再给方案。\n');
  put(brain, '90-system/notes.md', '退货 系统内部\n');
  put(brain, '30-lessons/corrections.md', '# 纠错\n\n- 退货运费以前说客户付，已改为公司付。\n');

  const T = { amy: tok(), ann: tok(), dan: tok(), eve: tok(), adm: tok(), revoked: tok(), off: tok() };
  fs.writeFileSync(path.join(dir, 'roster.json'), JSON.stringify({ people: [
    { pid: 'p1', login: 'amy', role: 'employee', dept: 'ops', status: 'active' },
    { pid: 'p2', login: 'bob', role: 'employee', dept: 'ops', status: 'disabled' },
    { pid: 'p3', login: 'ann', role: 'employee', dept: 'ops', status: 'active' },
    { pid: 'p4', login: 'dan', role: 'director', dept: 'ops', status: 'active' },
    { pid: 'p5', login: 'eve', role: 'employee', dept: 'sales', status: 'active' },
    { pid: 'p6', login: 'adm', role: 'admin', dept: 'company', status: 'active' },
  ] }));
  fs.writeFileSync(path.join(dir, 'gw-tokens.json'), JSON.stringify({ tokens: [
    { pid: 'p1', token: T.revoked, revoked_at: '2026-10-01T00:00:00' },
    { pid: 'p1', token: T.amy, revoked_at: '' },
    { pid: 'p2', token: T.off, revoked_at: '' },
    { pid: 'p3', token: T.ann, revoked_at: '' },
    { pid: 'p4', token: T.dan, revoked_at: '' },
    { pid: 'p5', token: T.eve, revoked_at: '' },
    { pid: 'p6', token: T.adm, revoked_at: '' },
  ] }));
  const port = await freePort();
  const log = path.join(dir, 'know.log');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'knowledge-search.js')], {
    env: { ...process.env, TDH_BRAIN: brain, TDH_COMPANY: company, TDH_KNOW_PORT: String(port), TDH_ROSTER: path.join(dir, 'roster.json'),
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
      ['revoked token', { Authorization: 'Bearer ' + T.revoked }],
      ['disabled person', { 'X-Company-Gw-Token': T.off }],
    ];
    for (const [why, headers] of deny) {
      const r = await ask(port, headers);
      assert.strictEqual(r.status, 401, why);
      assert.strictEqual(r.json.hits.length, 0, why);
    }

    const as = async (who, body) => {
      const r = await ask(port, { Authorization: 'Bearer ' + T[who] }, body);
      assert.strictEqual(r.status, 200, who);
      return r.json;
    };
    const paths = (r) => [...new Set(r.hits.map((h) => h.path))].sort();
    const q = { route: 'search', query: '退货' };

    // Who finds what for the same word.
    const seen = {};
    for (const who of ['amy', 'ann', 'dan', 'eve', 'adm']) seen[who] = paths(await as(who, q));
    const everyone = ['30-lessons/corrections.md', 'company/_handbook/_company/after-sales.docx'];
    for (const who of Object.keys(seen)) {
      for (const p of everyone) assert.ok(seen[who].includes(p), who + ' should see ' + p + ': ' + seen[who]);
      for (const p of seen[who]) {
        assert.ok(!/^10-l0\//.test(p), who + ' got a raw conversation from a search: ' + p);
        assert.ok(!/^90-system\//.test(p), who + ' got 90-system: ' + p);
      }
    }
    const want = {
      amy: { yes: ['company/_handbook/ops/warehouse.xlsx', '11-l1/ops/amy/2026-10-08.md', 'company/content/emp-amy/_memory/02-methods/note.md'],
        no: ['company/_handbook/sales/script.md', '20-l2/sales/lesson.md', 'company/_shared/_memory/01-projects/salary.md'] },
      ann: { yes: ['company/_handbook/ops/warehouse.xlsx'],
        no: ['11-l1/ops/amy/2026-10-08.md', 'company/content/emp-amy/_memory/02-methods/note.md', 'company/_handbook/sales/script.md'] },
      dan: { yes: ['company/_handbook/ops/warehouse.xlsx', '11-l1/ops/amy/2026-10-08.md'],
        no: ['company/content/emp-amy/_memory/02-methods/note.md', '20-l2/sales/lesson.md', 'company/_shared/_memory/01-projects/salary.md'] },
      eve: { yes: ['company/_handbook/sales/script.md', '20-l2/sales/lesson.md'],
        no: ['company/_handbook/ops/warehouse.xlsx', '11-l1/ops/amy/2026-10-08.md', 'company/_shared/_memory/01-projects/salary.md'] },
      adm: { yes: ['company/_handbook/ops/warehouse.xlsx', 'company/_handbook/sales/script.md', '11-l1/ops/amy/2026-10-08.md', '20-l2/sales/lesson.md', 'company/_shared/_memory/01-projects/salary.md'],
        no: ['company/content/emp-amy/_memory/02-methods/note.md'] },
    };
    for (const [who, w] of Object.entries(want)) {
      for (const p of w.yes) assert.ok(seen[who].includes(p), who + ' should find ' + p + ': ' + seen[who]);
      for (const p of w.no) assert.ok(!seen[who].includes(p), who + ' must not find ' + p);
    }

    // Raw conversation by path: the owner, their director, an admin; not a colleague.
    const l0 = { route: 'search', query: '老板', evidence: true, path: '10-l0/ops/amy/2026-10/2026-10-08.md' };
    for (const who of ['amy', 'dan', 'adm']) {
      const r = await as(who, l0);
      assert.strictEqual(r.status, 'ok', who + ' evidence');
      assert.ok(r.hits.some((h) => h.text.includes('先登记再寄回')), who + ' evidence text');
    }
    for (const who of ['ann', 'eve']) assert.strictEqual((await as(who, l0)).hits.length, 0, who + ' must not read amy l0');
    for (const bad of ['90-system/notes.md', '../roster.json', 'company/_shared/_memory/01-projects/salary.md']) {
      assert.strictEqual((await as('amy', { route: 'search', evidence: true, path: bad })).hits.length, 0, 'path ' + bad);
    }

    // Ranking and snippets.
    const deep = await as('amy', { route: 'search', query: '大客户报价' });
    assert.strictEqual(deep.hits[0].path, 'company/_shared/_memory/01-projects/pricing.md');
    assert.ok(deep.hits[0].text.includes('单价 12 元'), 'snippet is the hit, not the top of the file: ' + deep.hits[0].text);
    const lines = fs.readFileSync(path.join(company, '_shared/_memory/01-projects/pricing.md'), 'utf8').split('\n');
    assert.ok(lines[deep.hits[0].line - 1].includes('大客户报价'), 'line number points at the hit');
    // Words apart in the text, no dictionary: 运费 … 公司承担.
    const apart = await as('eve', { route: 'search', query: '运费谁承担' });
    assert.strictEqual(apart.hits[0].path, 'company/_handbook/_company/after-sales.docx');
    assert.ok(apart.hits[0].text.includes('运费由公司承担'), apart.hits[0].text);
    // A whole question: words that occur nowhere (是谁, 谁来) do not sink the answer.
    const question = await as('eve', { route: 'search', query: '客户退货的运费是谁来承担的？' });
    assert.strictEqual(question.hits[0].path, 'company/_handbook/_company/after-sales.docx', JSON.stringify(question.hits[0]));
    const ppt = await as('eve', { route: 'search', query: '发票抬头' });
    assert.strictEqual(ppt.hits[0].path, 'company/_handbook/_company/onboarding.pptx');
    assert.ok(ppt.hits[0].text.includes('第 2 页') || ppt.hits[0].text.includes('飞书审批'), ppt.hits[0].text);
    const sheet = await as('amy', { route: 'search', query: '破损' });
    assert.ok(sheet.hits.some((h) => h.path.endsWith('warehouse.xlsx') && h.text.includes('1001 | 退货入库 | 破损')), JSON.stringify(sheet.hits));
    // One character still finds something.
    assert.ok((await as('amy', { route: 'search', query: '税' })).status === 'not-found');
    assert.ok((await as('amy', { route: 'search', query: '运' })).hits.length > 0);
    // Nothing points at the server's own folders.
    const all = JSON.stringify(await as('adm', q));
    assert.ok(!all.includes(dir) && !all.includes(dir.replace(/\\/g, '\\\\')), 'server folders leaked');
    // Status says what was read and what was skipped.
    const st = await as('amy', { route: 'status' });
    assert.strictEqual(st.account, 'amy');
    assert.strictEqual(st.dept, 'ops');
    assert.ok(st.index.skipped['.pdf'] >= 1, JSON.stringify(st.index));

    const logged = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(logged.filter((l) => l.login === 'amy').length > 5);
    assert.ok(!fs.readFileSync(log, 'utf8').includes('退货'), 'log must not keep the question');
    console.log('KNOWLEDGE_AUTH_OK=1');
    console.log('KNOWLEDGE_SCOPE_OK=1');
    console.log('KNOWLEDGE_RANK_OK=1');
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
