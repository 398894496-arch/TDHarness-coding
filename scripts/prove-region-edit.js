#!/usr/bin/env node
// 局部修改（company-grok-media 的标注画布）的证明，不需要内核、不连 Grok：
//   1. 画布的几何（client.js 里的纯函数）：送去改的裁剪框不出图、盖住标注、是精确的标准比例
//      （xAI 改图把输出对齐到标准比例，比例不准贴回去会变形），随机 20000 组；标注外框、色调校正、
//      保存用的文件名
//   2. 服务端两扇门（lib/index.js），网关换成本机假服务：
//      region-edit 把裁片、比例、清晰度、包过的说明和个人令牌转给网关 /images；没写说明、不是图片、
//      不认识的比例、超大请求、网关报错各有各的回答
//      region-save 只收 PNG，写进会话工作目录的 artifacts/，名字里的路径符号被清掉
// 打印 REGION_EDIT_PROVE_OK=1。
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

// TDH_REGION_PLUGIN: 换成打过站点补丁的那份（安装包里的）再证一遍。
const PLUGIN = process.env.TDH_REGION_PLUGIN || path.join(__dirname, '..', 'desk', 'plugins', 'company-grok-media', 'lib');

function loadClient() {
  let mod = null;
  const sandbox = { window: { __ModuleLoader__: { load: (m) => { mod = m; } } }, URL, Math, console };
  vm.runInNewContext(fs.readFileSync(path.join(PLUGIN, 'client.js'), 'utf8'), sandbox, { filename: 'client.js' });
  assert.ok(mod && mod.id === 'company-grok-media', 'client module id');
  const exp = mod.factory(() => ({}));
  assert.strictEqual(typeof exp.apply, 'function');
  return exp.__test;
}

function proveGeometry(T) {
  const ratios = new Map(T.RATIOS.map((r) => [r[0], r[1]]));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let padded = 0;
  for (let i = 0; i < 20000; i++) {
    const W = 64 + Math.floor(rnd() * 5000);
    const H = 64 + Math.floor(rnd() * 5000);
    const bw = 1 + Math.floor(rnd() * W * (rnd() < 0.2 ? 1 : 0.4));
    const bh = 1 + Math.floor(rnd() * H * (rnd() < 0.2 ? 1 : 0.4));
    const bbox = { x: Math.floor(rnd() * (W - bw + 1)), y: Math.floor(rnd() * (H - bh + 1)), w: bw, h: bh };
    const c = T.cropBox(bbox, W, H);
    const tag = JSON.stringify({ W, H, bbox, c });
    for (const k of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(c[k]), 'integer ' + k + ' ' + tag);
    assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H, 'inside the image ' + tag);
    assert.ok(c.x <= bbox.x && c.y <= bbox.y && c.x + c.w >= bbox.x + bbox.w && c.y + c.h >= bbox.y + bbox.h, 'covers the marks ' + tag);
    assert.ok(ratios.has(c.ratio), 'known ratio ' + tag);
    // 送出去的画布是精确的标准比例（取整最多差 1 像素），裁片完整放在里面
    for (const k of ['pw', 'ph', 'ox', 'oy']) assert.ok(Number.isInteger(c[k]), 'integer ' + k + ' ' + tag);
    assert.ok(Math.abs(c.pw / ratios.get(c.ratio) - c.ph) <= 1, 'exact ratio ' + tag);
    assert.ok(c.ox >= 0 && c.oy >= 0 && c.ox + c.w <= c.pw && c.oy + c.h <= c.ph, 'crop inside the sent canvas ' + tag);
    if (c.pw !== c.w || c.ph !== c.h) padded++;
    else assert.ok(c.ox === 0 && c.oy === 0, 'no offset without padding ' + tag);
  }
  // 小标注要有上下文：至少 256（图够大时）
  const small = T.cropBox({ x: 1000, y: 800, w: 10, h: 10 }, 3000, 2000);
  assert.ok(small.w >= 256 && small.h >= 256, 'small marks get context ' + JSON.stringify(small));
  // 标注贴边：裁剪框贴边不出图
  const edge = T.cropBox({ x: 0, y: 0, w: 50, h: 400 }, 1000, 1000);
  assert.ok(edge.x === 0 && edge.y === 0, 'edge ' + JSON.stringify(edge));
  console.log('GEOMETRY_OK=1 cases=20000 padded=' + padded);

  const W = 5, H = 4, d = new Uint8ClampedArray(W * H * 4);
  assert.strictEqual(T.alphaBox(d, W, H), null, 'no marks');
  d[(1 * W + 2) * 4 + 3] = 255; d[(3 * W + 4) * 4 + 3] = 200; d[(2 * W + 0) * 4 + 3] = 5; // 5 低于阈值不算
  assert.strictEqual(JSON.stringify(T.alphaBox(d, W, H)), JSON.stringify({ x: 2, y: 1, w: 3, h: 3 }));

  const n = 400, orig = new Uint8ClampedArray(n * 4), edit = new Uint8ClampedArray(n * 4), mask = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { orig[i * 4] = 200; orig[i * 4 + 1] = 100; orig[i * 4 + 2] = 50; edit[i * 4] = 180; edit[i * 4 + 1] = 100; edit[i * 4 + 2] = 50; }
  const g = T.toneGains(orig, edit, mask);
  assert.ok(Math.abs(g[0] - 200 / 180) < 1e-9 && g[1] === 1 && g[2] === 1, 'tone gain ' + g);
  for (let i = 0; i < n; i++) edit[i * 4] = 20;
  assert.strictEqual(T.toneGains(orig, edit, mask)[0], 1.25, 'gain clamped');
  for (let i = 0; i < n; i++) mask[i * 4 + 3] = 255;
  assert.strictEqual(JSON.stringify(T.toneGains(orig, edit, mask)), '[1,1,1]', 'nothing outside the marks: no correction');
  assert.ok(T.featherPx(100, 100) === 2 && T.featherPx(5000, 5000) === 24, 'feather bounds');

  assert.strictEqual(T.stemFromPath('D:\\w\\artifacts\\autumn-lakeside-2026-10-14T09-45-43.png'), 'autumn-lakeside');
  assert.strictEqual(T.stemFromPath('/x/artifacts/autumn-lakeside-edit-2026-10-14T10-04-33.png'), 'autumn-lakeside');
  assert.strictEqual(T.stemFromPath('a-2026-10-14T09-45-43-edit-2026-10-14T10-04-33.png'), 'a');
  assert.strictEqual(T.stemFromPath(''), 'image');
  console.log('CLIENT_HELPERS_OK=1');
}

function fakeReq(method, body) {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  r.method = method;
  return r;
}

function call(handler, method, body) {
  return new Promise((resolve) => {
    const res = {
      status: 0,
      writeHead(s) { this.status = s; },
      end(b) { resolve({ status: this.status, body: JSON.parse(String(b)) }); },
    };
    handler(fakeReq(method, body), res);
  });
}

async function proveServer() {
  const seen = [];
  let reply = { status: 200, body: { files: [{ name: 'image-1.jpg', mime: 'image/jpeg', b64: Buffer.from('JPEGDATA').toString('base64') }] } };
  const door = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((r) => door.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + door.address().port;
  process.env.DEEPSEEK_API_KEY = 'dsh_prove_token';
  process.env.GROK_API_KEY = 'dsh_prove_token';

  const routes = {};
  const tools = [];
  const ctx = {
    tools: { register: (t) => tools.push(t.name) },
    get: (k) => (k === 'webServer' ? { register: (r) => { routes[r.path] = r.handler; return () => {}; } } : undefined),
    effect: (fn) => fn(),
  };
  const mod = await import(pathToFileURL(path.join(PLUGIN, 'index.js')).href);
  assert.deepStrictEqual(mod.inject, ['tools', 'webServer']);
  mod.apply(ctx, { baseURL: base + '/v1' });
  assert.deepStrictEqual(tools.sort(), ['generate_image', 'generate_video']);
  const edit = routes['/company/media/region-edit'];
  const save = routes['/company/media/region-save'];
  assert.ok(edit && save, 'both routes registered');

  const png = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');
  let out = await call(edit, 'POST', { prompt: '把树换成樱花', image: 'data:image/jpeg;base64,QUJD', aspect_ratio: '3:2', resolution: '2k' });
  assert.strictEqual(out.status, 200, JSON.stringify(out));
  assert.deepStrictEqual(out.body, { ok: true, mime: 'image/jpeg', b64: Buffer.from('JPEGDATA').toString('base64') });
  const sent = seen.pop();
  assert.strictEqual(sent.url, '/images');
  assert.strictEqual(sent.auth, 'Bearer dsh_prove_token');
  assert.strictEqual(sent.body.aspect_ratio, '3:2');
  assert.strictEqual(sent.body.resolution, '2k');
  assert.strictEqual(sent.body.n, 1);
  assert.deepStrictEqual(sent.body.image, { url: 'data:image/jpeg;base64,QUJD' });
  assert.ok(sent.body.prompt.indexOf('把树换成樱花') > 0 && /change only what is asked/.test(sent.body.prompt), 'wrapped prompt');

  out = await call(edit, 'POST', { prompt: 'x', image: png, aspect_ratio: '7:3', resolution: 'huge' });
  const sent2 = seen.pop();
  assert.ok(!('aspect_ratio' in sent2.body) && sent2.body.resolution === '1k', 'unknown ratio dropped, resolution defaults');

  const before = seen.length;
  assert.strictEqual((await call(edit, 'POST', { prompt: '  ', image: png })).status, 400, 'empty prompt');
  assert.strictEqual((await call(edit, 'POST', { prompt: 'x', image: 'data:text/html;base64,PGI+' })).status, 400, 'not an image');
  assert.strictEqual((await call(edit, 'POST', { prompt: 'x'.repeat(2001), image: png })).status, 400, 'prompt too long');
  assert.strictEqual((await call(edit, 'GET')).status, 405, 'method');
  assert.strictEqual((await call(edit, 'POST', '{not json')).status, 400, 'bad json');
  assert.strictEqual((await call(edit, 'POST', { prompt: 'x', image: 'data:image/png;base64,' + 'A'.repeat(31 * 1024 * 1024) })).status, 413, 'too large');
  assert.strictEqual(seen.length, before, 'refused requests never reach the gateway');

  reply = { status: 503, body: { error: { message: 'This server has no Grok key or subscription' } } };
  out = await call(edit, 'POST', { prompt: 'x', image: png });
  assert.strictEqual(out.status, 502);
  assert.ok(/no Grok key/.test(out.body.error), 'gateway message passed on: ' + out.body.error);
  reply = { status: 200, body: { files: [] } };
  out = await call(edit, 'POST', { prompt: 'x', image: png });
  assert.ok(out.status === 502 && out.body.error === 'company-media-empty', 'empty answer');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'region-save-'));
  const cwd = process.cwd();
  process.chdir(work);
  try {
    out = await call(save, 'POST', { image: png, name: '../../etc/passwd' });
    assert.strictEqual(out.status, 200, JSON.stringify(out));
    const p = out.body.path;
    assert.strictEqual(path.dirname(p), path.join(process.cwd(), 'artifacts'), 'saved under the session cwd artifacts/: ' + p);
    assert.ok(/^etc-passwd-edit-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/.test(path.basename(p)), 'clean name: ' + path.basename(p));
    assert.strictEqual(fs.readFileSync(p, 'utf8'), 'PNGDATA');
    assert.strictEqual((await call(save, 'POST', { image: 'data:image/jpeg;base64,QUJD', name: 'a' })).status, 400, 'PNG only');
    assert.strictEqual(fs.readdirSync(path.join(work, 'artifacts')).length, 1, 'nothing else written');
  } finally {
    process.chdir(cwd);
    fs.rmSync(work, { recursive: true, force: true });
  }
  door.close();
  console.log('SERVER_ROUTES_OK=1');
}

(async () => {
  proveGeometry(loadClient());
  await proveServer();
  console.log('REGION_EDIT_PROVE_OK=1');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
