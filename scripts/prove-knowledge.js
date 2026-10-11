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
// the text around the hit with its line, .docx / .xlsx / .pptx are read, a Chinese .pdf
// is read through pdf.js and the hit names its page, a scan and a broken .pdf are
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

// A PDF the way Chinese ones usually are: a Type0 font with Identity-H encoding, text as
// glyph ids, a ToUnicode CMap to read them back, the second page's content deflated.
// Each page is a list of lines; an empty list is a page with no text layer (a scan).
function pdf(pages) {
  const chars = [...new Set(pages.flat().join(''))];
  const cid = (s) => [...s].map((c) => (chars.indexOf(c) + 1).toString(16).padStart(4, '0')).join('');
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const stream = (dict, data) => Buffer.concat([Buffer.from('<<' + dict + ' /Length ' + data.length + '>>\nstream\n'), data, Buffer.from('\nendstream')]);
  const map = chars.map((c, i) => '<' + (i + 1).toString(16).padStart(4, '0') + '> <' + c.codePointAt(0).toString(16).padStart(4, '0') + '>').join('\n');
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /T def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
    + chars.length + ' beginbfchar\n' + map + '\nendbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const toUni = add(stream('', Buffer.from(cmap)));
  const desc = add(Buffer.from('<</Type /FontDescriptor /FontName /Fake /Flags 4 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80>>'));
  const cidFont = add(Buffer.from('<</Type /Font /Subtype /CIDFontType2 /BaseFont /Fake /CIDSystemInfo <</Registry (Adobe) /Ordering (Identity) /Supplement 0>> /FontDescriptor ' + desc + ' 0 R /DW 1000>>'));
  const font = add(Buffer.from('<</Type /Font /Subtype /Type0 /BaseFont /Fake /Encoding /Identity-H /DescendantFonts [' + cidFont + ' 0 R] /ToUnicode ' + toUni + ' 0 R>>'));
  const pagesId = objs.length + 1;
  objs.push(null);
  const kids = pages.map((lines, i) => {
    const ops = lines.map((l, k) => 'BT /F1 12 Tf 72 ' + (700 - 20 * k) + ' Td <' + cid(l) + '> Tj ET').join('\n');
    const content = i === 1 ? add(stream(' /Filter /FlateDecode', zlib.deflateSync(Buffer.from(ops)))) : add(stream('', Buffer.from(ops)));
    return add(Buffer.from('<</Type /Page /Parent ' + pagesId + ' 0 R /MediaBox [0 0 612 792] /Resources <</Font <</F1 ' + font + ' 0 R>>>> /Contents ' + content + ' 0 R>>'));
  });
  objs[pagesId - 1] = Buffer.from('<</Type /Pages /Kids [' + kids.map((k) => k + ' 0 R').join(' ') + '] /Count ' + kids.length + '>>');
  const root = add(Buffer.from('<</Type /Catalog /Pages ' + pagesId + ' 0 R>>'));
  const parts = [Buffer.from('%PDF-1.7\n')];
  const offs = [];
  let at = parts[0].length;
  objs.forEach((b, i) => {
    const o = Buffer.concat([Buffer.from((i + 1) + ' 0 obj\n'), b, Buffer.from('\nendobj\n')]);
    offs.push(at);
    parts.push(o);
    at += o.length;
  });
  const xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  parts.push(Buffer.from(xref + 'trailer\n<</Size ' + (objs.length + 1) + ' /Root ' + root + ' 0 R>>\nstartxref\n' + at + '\n%%EOF\n'));
  return Buffer.concat(parts);
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
  put(company, '_handbook/_company/expenses.pdf', pdf([['报销制度', '先在飞书提交申请'], ['差旅住宿每晚上限四百元', '超出部分自理']]));
  put(company, '_handbook/_company/scan.pdf', pdf([[]]));
  // Typed first page, scanned second page: only page 2 goes to OCR.
  put(company, '_handbook/_company/contract.pdf', pdf([['合同封面'], []]));
  put(company, '_handbook/_company/key.png', crypto.randomBytes(30 << 10));
  put(company, '_handbook/_company/fail-scan.pdf', pdf([[]]));
  // Old Office files as Word, Excel, PowerPoint and WPS wrote them (scripts/fixtures/legacy-office):
  // binary .doc .xls .ppt .dps, and .wps / .et that WPS saved as zip. Each says refund-doc.
  for (const f of fs.readdirSync(path.join(__dirname, 'fixtures', 'legacy-office'))) {
    put(company, '_handbook/_company/' + f, fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-office', f)));
  }
  // A .docx renamed .doc is still read as a .docx.
  fs.copyFileSync(path.join(company, '_handbook/_company/after-sales.docx'), path.join(company, '_handbook/_company/renamed.doc'));
  // legacy-office.py needs olefile and xlrd (CI installs them; locally PROVE_PY can point at a venv).
  const py = process.env.PROVE_PY || (process.platform === 'win32' ? 'python' : 'python3');
  const probe = require('child_process').spawnSync(py, ['-c', 'import olefile, xlrd'], { encoding: 'utf8' });
  assert.strictEqual(probe.status, 0, py + ' has no olefile / xlrd: pip install olefile==0.47 xlrd==2.0.1 ' + (probe.stderr || ''));
  // Stands in for ocr.py: slow on purpose, writes what a real run would, fails on fail-*.
  const stub = path.join(dir, 'ocr-stub.js');
  fs.writeFileSync(stub, [
    "const fs = require('fs'); const a = process.argv.slice(2); const at = (k) => a[a.indexOf(k) + 1];",
    "const file = at('--file'); const pages = at('--pages').split(',');",
    "setTimeout(() => {",
    "  const out = {}; const r = { pages: out };",
    "  if (/fail-/.test(file)) { fs.writeFileSync(at('--out'), JSON.stringify({ error: 'stub-failed' })); process.exit(2); }",
    "  if (/key\\.png$/.test(file)) out['1'] = '保险柜钥匙放在财务抽屉';",
    "  else if (/contract/.test(file)) for (const p of pages) out[p] = '违约金按合同总额百分之五 pages=' + pages.join(',');",
    "  else for (const p of pages) out[p] = '考勤每月五号前提交';",
    "  fs.writeFileSync(at('--out'), JSON.stringify(r));",
    "}, 1500);",
  ].join('\n'));
  put(company, '_handbook/_company/broken.pdf', '%PDF-1.4 退货');
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
      TDH_GW_TOKENS: path.join(dir, 'gw-tokens.json'), TDH_KNOW_LOG: log, TDH_KB_CACHE: path.join(dir, 'kb-cache'),
      TDH_OCR_EXE: process.execPath, TDH_OCR_ARGS: JSON.stringify([stub]),
      TDH_LEGACY_EXE: py, TDH_LEGACY_ARGS: JSON.stringify([path.join(__dirname, '..', 'server', 'legacy-office.py')]) },
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
    // Words apart in the text, no dictionary: 寄回 … 运费 … 公司承担.
    const apart = await as('eve', { route: 'search', query: '寄回运费谁承担' });
    assert.strictEqual(apart.hits[0].path, 'company/_handbook/_company/after-sales.docx');
    assert.ok(apart.hits[0].text.includes('运费由公司承担'), apart.hits[0].text);
    // A whole question: words that occur nowhere (是谁, 谁来) do not sink the answer.
    const question = await as('eve', { route: 'search', query: '客户申请退货寄回的运费是谁来承担的？' });
    assert.strictEqual(question.hits[0].path, 'company/_handbook/_company/after-sales.docx', JSON.stringify(question.hits[0]));
    const ppt = await as('eve', { route: 'search', query: '发票抬头' });
    assert.strictEqual(ppt.hits[0].path, 'company/_handbook/_company/onboarding.pptx');
    assert.ok(ppt.hits[0].text.includes('第 2 页') || ppt.hits[0].text.includes('飞书审批'), ppt.hits[0].text);
    const sheet = await as('amy', { route: 'search', query: '破损' });
    assert.ok(sheet.hits.some((h) => h.path.endsWith('warehouse.xlsx') && h.text.includes('1001 | 退货入库 | 破损')), JSON.stringify(sheet.hits));
    // PDF: Chinese read back through ToUnicode, from a deflated page, and the hit says which page.
    const stay = await as('eve', { route: 'search', query: '住宿上限多少' });
    assert.strictEqual(stay.hits[0].path, 'company/_handbook/_company/expenses.pdf', JSON.stringify(stay.hits));
    assert.ok(stay.hits[0].text.startsWith('〔第 2 页〕') && stay.hits[0].text.includes('每晚上限四百元'), stay.hits[0].text);
    assert.ok(fs.readdirSync(path.join(dir, 'kb-cache')).some((f) => f.endsWith('.txt')), 'pdf text cached on disk');
    // OCR runs in the background: a search while it works answers at once.
    let t0 = Date.now();
    await as('amy', { route: 'search', query: '考勤' });
    await as('amy', { route: 'search', query: '考勤' });
    assert.ok(Date.now() - t0 < 1200, 'search waited for OCR: ' + (Date.now() - t0) + 'ms');
    const waitOcr = async () => {
      for (let i = 0; i < 100; i++) {
        const i = (await as('adm', { route: 'status' })).index;
        const s = i.ocr;
        if (s.queued === 0 && s.running === 0 && s.done + s.failed >= 4 && i.legacy.done + i.legacy.failed >= 4) return s;
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new Error('ocr never finished');
    };
    const ocr = await waitOcr();
    assert.deepStrictEqual([ocr.done, ocr.failed], [3, 1], JSON.stringify(ocr));
    // Status is current as soon as a job ends, not after the next search.
    assert.ok(!(await as('adm', { route: 'status' })).index.skipped['ocr-pending'], 'nothing left pending');
    const scan = await as('eve', { route: 'search', query: '考勤几号提交' });
    assert.strictEqual(scan.hits[0].path, 'company/_handbook/_company/scan.pdf', JSON.stringify(scan.hits));
    assert.ok(scan.hits[0].text.startsWith('〔第 1 页〕 考勤'), 'page named once, then the text: ' + scan.hits[0].text);
    const mixed = await as('eve', { route: 'search', query: '违约金' });
    assert.strictEqual(mixed.hits[0].path, 'company/_handbook/_company/contract.pdf');
    assert.ok(mixed.hits[0].text.includes('pages=2') && !mixed.hits[0].text.includes('pages=1'), 'only the scanned page: ' + mixed.hits[0].text);
    assert.ok((await as('eve', { route: 'search', query: '合同封面' })).hits.length > 0, 'the typed page stays');
    const pic = await as('eve', { route: 'search', query: '保险柜钥匙在哪' });
    assert.strictEqual(pic.hits[0].path, 'company/_handbook/_company/key.png');
    assert.ok(pic.hits[0].text.startsWith('〔图片〕'), pic.hits[0].text);
    // Old Office files, binary or zip whatever the name says, all found; slides keep their number.
    const legacy = (await as('eve', { route: 'search', query: 'refund-doc' })).hits.map((h) => h.path);
    for (const f of ['word97.doc', 'excel97.xls', 'ppt97.ppt', 'kingsoft.dps', 'kingsoft.wps', 'kingsoft.et']) {
      assert.ok(legacy.includes('company/_handbook/_company/' + f), f + ' not found: ' + legacy);
    }
    const lst = (await as('adm', { route: 'status' })).index.legacy;
    assert.deepStrictEqual([lst.done, lst.failed], [4, 0], 'four binary files, no failures: ' + JSON.stringify(lst));
    const slide = (await as('eve', { route: 'search', query: '仓库钥匙在前台' })).hits.find((h) => h.path.endsWith('ppt97.ppt'));
    assert.ok(slide && slide.text.startsWith('〔第 3 页〕'), JSON.stringify(slide));
    const cell = (await as('eve', { route: 'search', query: '差旅住宿' })).hits.find((h) => h.path.endsWith('excel97.xls'));
    assert.ok(cell && cell.text.includes('1001 | 差旅住宿每晚上限四百元'), JSON.stringify(cell));
    const box = (await as('eve', { route: 'search', query: '差旅住宿' })).hits.find((h) => h.path.endsWith('ppt97.ppt'));
    assert.ok(box && box.text.startsWith('〔第 2 页〕'), 'a text box, not a placeholder: ' + JSON.stringify(box));
    assert.ok((await as('eve', { route: 'search', query: '运费由公司承担' })).hits.some((h) => h.path.endsWith('renamed.doc')), 'renamed docx');
    // A failed job is recorded and not run again on every search.
    await as('adm', { route: 'search', query: '考勤' });
    const again = (await as('adm', { route: 'status' })).index;
    assert.strictEqual(again.ocr.failed, 1);
    assert.strictEqual(again.ocr.queued + again.ocr.running, 0);
    assert.ok(again.skipped['ocr-failed'] >= 1, JSON.stringify(again));
    // Without OCR a scan is reported, and pictures are not looked at.
    {
      const { createIndex } = require('../server/kb-index');
      const plain = createIndex({ cacheDir: path.join(dir, 'kb-cache-plain') });
      plain.docs([path.join(company, '_handbook')]);
      const s = plain.stats();
      assert.ok(s.skipped['pdf-no-text'] >= 2, JSON.stringify(s));
      assert.ok(!s.skipped['.png'] && !s.skipped['ocr-pending'], JSON.stringify(s));
      assert.ok(s.skipped['.doc'] >= 1 && s.skipped['.ppt'] >= 1, 'binary Office files without the venv: ' + JSON.stringify(s));
      assert.ok(!s.skipped['.wps'], 'a zip .wps needs no venv: ' + JSON.stringify(s));
      assert.strictEqual(s.ocr.on, false);
    }
    // The company's synonym list reaches the search: the files only ever say 运费, never 邮费.
    put(company, '_handbook/_company/同义词.txt', '运费 = 邮费\n');
    const syn = await as('eve', { route: 'search', query: '邮费' });
    assert.ok(syn.hits.length && syn.hits[0].text.includes('运费') && syn.hits.some((h) => h.path === 'company/_handbook/_company/after-sales.docx'), 'synonym list used: ' + JSON.stringify(syn.hits.slice(0, 3)));
    assert.ok(!syn.hits.some((h) => h.path.endsWith('同义词.txt')), 'the list itself is not searched');
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
    assert.ok(st.index.skipped['pdf-unreadable'] >= 1, 'a broken pdf is reported: ' + JSON.stringify(st.index));

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
