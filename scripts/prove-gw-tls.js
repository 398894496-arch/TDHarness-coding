#!/usr/bin/env node
'use strict';

// Behavior proof for the gateway's TLS move and the /fetch guard. No network:
// names are mapped by the guard's test hook, pages come from local servers.
//   1. /fetch refuses private addresses where the name really resolves, on every
//      redirect hop, and for literal addresses; public pages still read.
//   2. The client patch moves every gateway address to https://<host>:8443/gw and
//      makes the Mac launcher trust the shipped root; without a CA nothing moves.
//   3. TDHarness.exe's gateway follows the same switch (site-cs.py emit-cs).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const gwSearch = require(path.join(ROOT, 'server', 'gw-search.js'));
const cn = require(path.join(ROOT, 'server', 'web-search.js'));

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function proveFetchGuard() {
  const { privateIp, fetchGuardTest } = gwSearch;
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.50.10', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', 'fd7a::1', 'fe80::1', '::ffff:192.168.1.1', '224.0.0.1']) {
    assert.equal(privateIp(ip), true, ip + ' is private');
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(privateIp(ip), false, ip + ' is public');

  let b = null;
  const a = await listen((req, res) => {
    const to = { '/to-literal': 'http://127.0.0.2:' + b.address().port + '/x', '/to-inside': 'http://inside.test:' + b.address().port + '/x', '/to-public': 'http://public-b.test:' + b.address().port + '/ok' }[req.url];
    if (to) { res.writeHead(302, { location: to }); res.end(); return; }
    res.end('page a');
  });
  b = await listen((req, res) => { res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end('page b ' + req.url); });
  // The local servers stand in for public hosts; everything else keeps its real class.
  fetchGuardTest.allow.add('127.0.0.1');
  fetchGuardTest.resolve['public-a.test'] = '127.0.0.1';
  fetchGuardTest.resolve['public-b.test'] = '127.0.0.1';
  fetchGuardTest.resolve['inside.test'] = '10.1.2.3';
  // The very guard runFetch uses for its direct reads.
  const read = (u) => cn.get(u, Object.assign({ timeout: 4000 }, gwSearch.fetchGuard));
  const pa = 'http://public-a.test:' + a.address().port;
  try {
    const ok = await read(pa + '/to-public');
    assert.equal(ok.status, 200);
    assert.equal(cn.decode(ok), 'page b /ok', 'a public page behind a redirect still reads');
    await assert.rejects(read(pa + '/to-literal'), /fetch-blocked/, 'redirect to a literal private address');
    await assert.rejects(read(pa + '/to-inside'), /fetch-blocked/, 'redirect to a name that resolves inside');
    await assert.rejects(read('http://inside.test:' + b.address().port + '/'), /fetch-blocked/, 'a name that resolves inside');
    // runFetch: the written address is refused before anything goes out, and a
    // gov.cn page (read directly first) that resolves inside is refused, not retried.
    await assert.rejects(gwSearch.runFetch(() => { throw new Error('no-network'); }, 'http://192.168.50.10:8443/'), /fetch-blocked/);
    fetchGuardTest.resolve['intranet.gov.cn'] = '10.0.0.9';
    await assert.rejects(gwSearch.runFetch(() => { throw new Error('no-network'); }, 'http://intranet.gov.cn:' + b.address().port + '/'), /fetch-blocked/);
  } finally {
    a.close();
    b.close();
  }
  console.log('FETCH_GUARD_OK=1');
}

function python() {
  return ['python3', 'python'].find((n) => spawnSync(n, ['--version']).status === 0);
}

function proveClientPatch(py) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-gw-tls-'));
  const code = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'rel, src = sys.argv[2], open(sys.argv[3], encoding="utf-8").read()',
    't, how = m.patch(rel, src, "8443")',
    't2, how2 = m.patch(rel, t, "8443")',
    'open(sys.argv[3], "w", encoding="utf-8").write(t)',
    'print(how, how2)'
  ].join('\n');
  const run = (rel, text) => {
    const f = path.join(dir, path.basename(rel) + '.txt');
    fs.writeFileSync(f, text);
    const r = spawnSync(py, ['-I', '-c', code, path.join(ROOT, 'server', 'site-patches', 'patch_gw_tls.py'), rel, f], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return { how: r.stdout.trim(), text: fs.readFileSync(f, 'utf8') };
  };
  let r = run('home/profiles/web/overlay.yml', '- id: company-web-search\n  config:\n    baseURL: http://tdh.local:8450\n');
  assert.equal(r.how, 'patched-gw-tls already');
  assert.match(r.text, /baseURL: https:\/\/tdh\.local:8443\/gw\n/);
  r = run('home/profiles/web/cordis.patch.yml', '        baseURL: http://{{TDH_HOST}}:8450/v1\n');
  assert.match(r.text, /https:\/\/\{\{TDH_HOST\}\}:8443\/gw\/v1/);
  r = run('plugins/company-shell/lib/index.js', 'function gwBase() {\n\ttry {\n\t\tconst u = new URL(siteBase());\n\t\treturn "http://" + u.hostname + ":8450";\n\t} catch {\n\t\treturn "http://tdh.local:8450";\n\t}\n}\n');
  assert.match(r.text, /return "https:\/\/" \+ u\.host \+ "\/gw";/);
  assert.match(r.text, /return "https:\/\/tdh\.local:8443\/gw";/);
  const sh = 'set -euo pipefail\nexport DEEPSEEK_BASE_URL=http://tdh.local:8450/v1\nunset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy\necho ok\n';
  r = run('start.command', sh);
  assert.match(r.text, /DEEPSEEK_BASE_URL=https:\/\/tdh\.local:8443\/gw\/v1/);
  assert.match(r.text, /if \[ -f "\$ROOT\/company-ca\.crt" \]; then export NODE_EXTRA_CA_CERTS=/);
  if (process.platform !== 'win32') {
    // Under set -e the launcher must survive a pack without the root.
    const f = path.join(dir, 'start.sh');
    fs.writeFileSync(f, r.text);
    const b = spawnSync('bash', [f], { encoding: 'utf8', env: Object.assign({}, process.env, { ROOT: dir }) });
    assert.equal(b.status, 0, b.stderr);
    assert.equal(b.stdout.trim(), 'ok');
  }
  console.log('GW_TLS_PATCH_OK=1');
}

function proveAppHostSwitch(py) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-gw-cs-'));
  const site = path.join(dir, 'site.yml');
  fs.writeFileSync(site, 'host: tdh.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n');
  const emit = (ca) => {
    const out = path.join(dir, 'Site.cs');
    const r = spawnSync(py, [path.join(ROOT, 'server', 'site-cs.py'), '--site', site, 'emit-cs', '--out', out], { encoding: 'utf8', env: Object.assign({}, process.env, { TDH_COMPANY_CA: ca }) });
    assert.equal(r.status, 0, r.stderr);
    return fs.readFileSync(out, 'utf8');
  };
  assert.match(emit(path.join(dir, 'none.crt')), /GatewayBase = "http:\/\/tdh\.local:8450\/v1"/, 'no root yet: plain 8450');
  fs.writeFileSync(path.join(dir, 'ca.crt'), '-----BEGIN CERTIFICATE-----\n');
  assert.match(emit(path.join(dir, 'ca.crt')), /GatewayBase = "https:\/\/tdh\.local:8443\/gw\/v1"/, 'root exported: TLS through Caddy');
  const caddy = path.join(dir, 'Caddyfile');
  assert.equal(spawnSync(py, [path.join(ROOT, 'server', 'site-cs.py'), '--site', site, 'emit-caddy', '--out', caddy]).status, 0);
  assert.match(fs.readFileSync(caddy, 'utf8'), /handle_path \/gw\/\* \{\n\t\treverse_proxy 127\.0\.0\.1:8450 \{\n\t\t\tflush_interval -1/);
  console.log('GW_TLS_APPHOST_OK=1');
}

async function main() {
  await proveFetchGuard();
  const py = python();
  if (!py) { console.log('GW_TLS_PY_SKIPPED=no-python'); } else { proveClientPatch(py); proveAppHostSwitch(py); }
  console.log('GW_TLS_PROVE_OK=1');
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
