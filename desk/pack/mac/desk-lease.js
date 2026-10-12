#!/usr/bin/env node
'use strict';
/**
 * One seat per account. Chat lives on the person's share (.dsh-desk).
 * Local DSH_HOME keeps plugins/state only. Chat belongs on the share
 * (.dsh-desk). Harvest local leftovers onto the share, then delete local.
 */
const fs = require('fs');
const dns = require('dns');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const DESK_PORT = 17803;
const KICK_WAIT_MS = 50000;
const HEARTBEAT_MS = 12000;
// company-lease-derp-hb-v1: over DERP one TLS handshake to 8443 is ~2s and
// bursts past 20s; 1881 lease-http-timeout in one log. Wider budget, slower
// retry. Server TTL unchanged, heartbeat cadence unchanged.
const HEARTBEAT_RETRY_MS = 5000;
const REQUEST_TIMEOUT_MS = 45000;
const NOTE_OTHER = '这个账号已在其他设备登录，本机已退出。';
const NOTE_EXPIRED = '座位已过期，请重新打开。';

function die(msg, code) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code == null ? 2 : code);
}

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0 || i + 1 >= process.argv.length) return fallback || '';
  return process.argv[i + 1];
}

function rcDir() {
  return arg('rc') || path.join(os.homedir(), '.dsh-company-rc8');
}

function readTrim(p) {
  try {
    return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/[\r\n]+/g, '').trim();
  } catch {
    return '';
  }
}

function readJsonFile(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeAscii(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, String(text).replace(/\r/g, '') + (String(text).endsWith('\n') ? '' : '\n'), 'utf8');
}

function deviceId() {
  const p = path.join(rcDir(), 'device.id');
  let id = readTrim(p);
  if (/^[A-Za-z0-9._-]{8,80}$/.test(id)) return id;
  id = 'dev-' + require('crypto').randomBytes(8).toString('hex');
  writeAscii(p, id);
  try { fs.chmodSync(p, 0o600); } catch { /* win */ }
  return id;
}

function norm(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
}

function livePath(p) {
  const n = norm(p);
  if (!n) return n;
  try {
    if (fs.existsSync(n)) return fs.realpathSync(n);
  } catch { /* keep n */ }
  return n;
}

function slug(p) {
  const cwd = String(p || '');
  if (!cwd) return '--root--';
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const ch = cwd.charAt(i);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--';
}

function companyRel(p) {
  const n = norm(p);
  const low = n.toLowerCase();
  const keys = ['/dsh/company', '/dsh-company', '/company'];
  let best = null;
  let hit = false;
  for (const k of keys) {
    const i = low.lastIndexOf(k);
    if (i < 0) continue;
    hit = true;
    let rest = n.slice(i + k.length);
    if (rest.startsWith('/')) rest = rest.slice(1);
    if (best == null || rest.length >= best.length) best = rest;
  }
  return hit ? (best || '') : null;
}

function shareRoot(personal) {
  const n = norm(personal);
  const rel = companyRel(n);
  if (!rel) return n;
  const suf = '/' + rel;
  if (n.length > suf.length && n.slice(-suf.length).toLowerCase() === suf.toLowerCase()) {
    return n.slice(0, n.length - suf.length);
  }
  return n;
}

function yamlRoot(p) {
  return JSON.stringify(norm(p));
}

function httpsAgent() {
  return new https.Agent({ rejectUnauthorized: false });
}

function lookup4(hostname, options, cb) {
  dns.lookup(hostname, { family: 4, all: false }, cb);
}

const OFFICE_TS_IP = process.env.OFFICE_TS_IP || '{{TDH_HOST}}';
// After the first success, keep that dial. Home DERP: {{TDH_HOST}}/32 is a
// black hole (45s timeout per heartbeat) while the office 100.x answers.
let leaseDialHost = '';

function requestOnce(method, u, raw, token, dialHost, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: dialHost,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      family: 4,
      lookup: lookup4,
      servername: u.hostname,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        Host: u.host,
      },
      timeout: timeoutMs,
    };
    if (u.protocol === 'https:') opts.agent = httpsAgent();
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (raw) {
      opts.headers['Content-Type'] = 'application/json; charset=utf-8';
      opts.headers['Content-Length'] = Buffer.byteLength(raw);
    }
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        resolve({ status: res.statusCode || 0, data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('lease-http-timeout')); });
    if (raw) req.write(raw);
    req.end();
  });
}

function requestJson(method, urlStr, body, token) {
  const u = new URL(urlStr);
  const raw = body == null ? '' : JSON.stringify(body);
  const ts = OFFICE_TS_IP;
  if (leaseDialHost) {
    return requestOnce(method, u, raw, token, leaseDialHost, REQUEST_TIMEOUT_MS);
  }
  const firstMs = u.hostname === ts ? REQUEST_TIMEOUT_MS : 4000;
  return requestOnce(method, u, raw, token, u.hostname, firstMs)
    .then((hit) => {
      leaseDialHost = u.hostname;
      return hit;
    })
    .catch((err) => {
      if (u.hostname === ts) throw err;
      process.stdout.write('LEASE_DIAL_TS=1\n');
      return requestOnce(method, u, raw, token, ts, REQUEST_TIMEOUT_MS).then((hit) => {
        leaseDialHost = ts;
        return hit;
      });
    });
}

function leaseUrl() {
  const site = arg('site') || readTrim(path.join(rcDir(), 'site.login')) || process.env.COMPANY_SITE || '';
  if (!site) throw new Error('lease-site-missing');
  return site.replace(/\/company\/login\/?$/, '').replace(/\/$/, '') + '/company/desk-lease';
}

function token() {
  return process.env.DEEPSEEK_API_KEY || readTrim(path.join(rcDir(), 'gw.token'));
}

function personalPath() {
  return arg('personal') || readTrim(path.join(rcDir(), 'work.personal'));
}

function orgPath() {
  return arg('org') || readTrim(path.join(rcDir(), 'work.org'));
}

function loginRole() {
  return (arg('role') || readTrim(path.join(rcDir(), 'login.role')) || '').trim();
}

function canAuthorPresets(role) {
  return role === 'admin' || role === 'director';
}

function deskHome() {
  return arg('home') || process.env.DSH_HOME || path.join(rcDir(), 'desk-home');
}

function roamRoot(personal) {
  const n = norm(personal);
  if (process.platform === 'win32') {
    const rel = companyRel(n);
    if (rel != null) {
      const local = path.join('D:/dsh/company', rel);
      if (fs.existsSync(local)) return path.join(norm(local), '.dsh-desk');
    }
  }
  return path.join(n, '.dsh-desk');
}

function assertShareWritable(personal) {
  const root = roamRoot(personal);
  try {
    fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'storages'), { recursive: true });
    const p = path.join(root, '.write-ok');
    fs.writeFileSync(p, '1');
    try { fs.unlinkSync(p); } catch { /* ok */ }
  } catch (e) {
    throw new Error('company-workspace-unwritable');
  }
}

function wipeLocalSessions(home) {
  for (const name of ['sessions', 'storages']) {
    const p = path.join(home, name);
    fs.rmSync(p, { recursive: true, force: true });
  }
  process.stdout.write('LOCAL_SESSIONS_WIPED=1\n');
}

function sessionLogTurns(file) {
  try {
    const text = readSessionLog(file);
    let n = 0;
    for (const line of text.split('\n')) {
      if (line.trim()) n += 1;
    }
    return Math.max(0, n - 1);
  } catch {
    return 0;
  }
}

function sessionFileRicher(src, dst) {
  if (!fs.existsSync(dst)) return true;
  const srcTurns = sessionLogTurns(src);
  const dstTurns = sessionLogTurns(dst);
  if (srcTurns !== dstTurns) return srcTurns > dstTurns;
  try {
    return fs.statSync(src).size > fs.statSync(dst).size;
  } catch {
    return false;
  }
}

function collectSessionBodies(dir) {
  const out = {};
  if (!dir || !fs.existsSync(dir)) return out;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = path.join(d, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(p);
      else if (name === 'session.jsonl' || name === 'session.jsonl.zstd') {
        const sid = path.basename(path.dirname(p));
        if (sid.indexOf('session-') !== 0) continue;
        let bytes = 0;
        try { bytes = fs.statSync(p).size; } catch { continue; }
        const turns = sessionLogTurns(p);
        const prev = out[sid];
        if (!prev || turns > prev.turns || (turns === prev.turns && bytes > prev.bytes)) {
          out[sid] = { bytes: bytes, turns: turns };
        }
      }
    }
  };
  walk(dir);
  return out;
}

function lookupSessionBody(dir, sid) {
  if (!dir || !sid || !fs.existsSync(dir)) return null;
  let best = null;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = path.join(d, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (name === sid) {
        for (const log of ['session.jsonl', 'session.jsonl.zstd']) {
          const f = path.join(p, log);
          let bytes = 0;
          try { bytes = fs.statSync(f).size; } catch { continue; }
          const turns = sessionLogTurns(f);
          if (!best || turns > best.turns || (turns === best.turns && bytes > best.bytes)) {
            best = { bytes: bytes, turns: turns };
          }
        }
        continue;
      }
      if (name.indexOf('session-') === 0) continue;
      walk(p);
    }
  };
  walk(dir);
  return best;
}

function copyTreeMerge(src, dst) {
  if (!fs.existsSync(src)) return 0;
  const st = fs.lstatSync(src);
  if (st.isSymbolicLink()) return 0;
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const name of fs.readdirSync(src)) {
      n += copyTreeMerge(path.join(src, name), path.join(dst, name));
    }
    return n;
  }
  if (fs.existsSync(dst)) {
    const base = path.basename(src);
    if (base === 'session.jsonl' || base === 'session.jsonl.zstd') {
      if (!sessionFileRicher(src, dst)) return 0;
    } else {
      try {
        if (fs.statSync(src).size <= fs.statSync(dst).size) return 0;
      } catch {
        return 0;
      }
    }
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return 1;
}

function workspaceHasSessions(wsPath) {
  try {
    const ws = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
    const tables = (ws.tables && ws.tables.workspaces) || {};
    for (const id of Object.keys(tables)) {
      const ids = tables[id] && tables[id].sessionIds;
      if (Array.isArray(ids) && ids.length) return true;
    }
    if (ws.tables && ws.tables.sessions && Object.keys(ws.tables.sessions).length) return true;
    return false;
  } catch {
    return false;
  }
}

function harvestWorkspace(srcWs, dstWs) {
  if (!fs.existsSync(srcWs)) return 0;
  fs.mkdirSync(path.dirname(dstWs), { recursive: true });
  if (!fs.existsSync(dstWs)) {
    fs.copyFileSync(srcWs, dstWs);
    return 1;
  }
  let src;
  let dst;
  try {
    src = JSON.parse(fs.readFileSync(srcWs, 'utf8'));
    dst = JSON.parse(fs.readFileSync(dstWs, 'utf8'));
  } catch {
    if (workspaceHasSessions(srcWs) && !workspaceHasSessions(dstWs)) {
      fs.copyFileSync(srcWs, dstWs);
      return 1;
    }
    return 0;
  }
  if (!src.tables || !src.tables.workspaces) return 0;
  if (!dst.tables) dst.tables = {};
  if (!dst.tables.workspaces) dst.tables.workspaces = {};
  let changed = 0;
  const dstByTitle = {};
  for (const id of Object.keys(dst.tables.workspaces)) {
    const t = dst.tables.workspaces[id] && dst.tables.workspaces[id].title;
    if (t) dstByTitle[t] = id;
  }
  for (const id of Object.keys(src.tables.workspaces)) {
    const row = src.tables.workspaces[id];
    if (!row) continue;
    const ids = Array.isArray(row.sessionIds) ? row.sessionIds : [];
    const destId = (row.title && dstByTitle[row.title]) || id;
    if (!dst.tables.workspaces[destId]) continue;
    const prev = Array.isArray(dst.tables.workspaces[destId].sessionIds)
      ? dst.tables.workspaces[destId].sessionIds
      : [];
    const next = prev.slice();
    for (const sid of ids) {
      if (typeof sid === 'string' && sid && next.indexOf(sid) < 0) {
        next.push(sid);
        changed = 1;
      }
    }
    dst.tables.workspaces[destId].sessionIds = next;
  }
  if (!changed) return 0;
  fs.writeFileSync(dstWs, JSON.stringify(dst, null, 2) + '\n');
  return 1;
}

function zstdFileOk(file) {
  const t = spawnSync('zstd', ['-t', file], { encoding: 'utf8', timeout: 5000 });
  if (t.error && t.error.code === 'ENOENT') return true;
  return t.status === 0;
}

function sweepBadLocalZstd(home) {
  const dir = path.join(home, 'sessions');
  if (!dir || !fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = path.join(d, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(p);
      else if (name === 'session.jsonl.zstd' && !zstdFileOk(p)) {
        try { fs.unlinkSync(p); n += 1; } catch { /* */ }
      }
    }
  };
  walk(dir);
  if (n) process.stdout.write('SESSION_SWEEP_BAD_ZSTD=' + n + '\n');
  return n;
}

function countSessionLogs(dir) {
  if (!dir || !fs.existsSync(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = path.join(d, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) walk(p);
      else if (name === 'session.jsonl' || name === 'session.jsonl.zstd') n += 1;
    }
  };
  walk(dir);
  return n;
}

function harvestLocalSessions(home, personal) {
  if (!personal || !fs.existsSync(home)) {
    process.stdout.write('LOCAL_SESSIONS_HARVESTED=0\n');
    return 0;
  }
  const roam = roamRoot(personal);
  const srcS = path.join(home, 'sessions');
  const srcT = path.join(home, 'storages');
  const dstS = path.join(roam, 'sessions');
  const dstT = path.join(roam, 'storages');
  let n = 0;
  if (fs.existsSync(srcS)) n += copyTreeMerge(srcS, dstS);
  n += harvestWorkspace(path.join(srcT, 'workspace.json'), path.join(dstT, 'workspace.json'));
  const srcPc = path.join(srcT, 'session_projcache.json');
  const dstPc = path.join(dstT, 'session_projcache.json');
  if (fs.existsSync(srcPc) && !fs.existsSync(dstPc)) {
    fs.mkdirSync(dstT, { recursive: true });
    fs.copyFileSync(srcPc, dstPc);
    n += 1;
  }
  process.stdout.write('LOCAL_SESSIONS_HARVESTED=' + n + '\n');
  return n;
}

function harvestThenWipe(home, personal, opts) {
  // company-session-no-wipe-unread-v1
  // Never wipe local chats if the share still has a thinner copy
  // (header-only stub, fewer turns, or fewer bytes).
  // company-lease-smb-skip-dest-v1: empty local must not read every
  // chair session.jsonl over SMB just to compare nothing.
  // company-lease-derp-skip-share-v1: DERP must not copyTreeMerge
  // local jsonl onto the chair during splash (same hang as rsync).
  const wipe = !opts || opts.wipe !== false;
  const skipShare = !!(opts && opts.skipShare);
  const srcDir = path.join(home, 'sessions');
  const dstDir = path.join(roamRoot(personal), 'sessions');
  if (skipShare) {
    process.stdout.write('HARVEST_SKIP_SHARE=1\n');
    process.stdout.write('LOCAL_SESSIONS_HARVESTED=0\n');
    if (wipe) wipeLocalSessions(home);
    return;
  }
  const beforeBodies = collectSessionBodies(srcDir);
  harvestLocalSessions(home, personal);
  const sids = Object.keys(beforeBodies);
  if (!sids.length) {
    process.stdout.write('HARVEST_SKIP_DEST=1\n');
    if (wipe) wipeLocalSessions(home);
    return;
  }
  for (const sid of sids) {
    const loc = beforeBodies[sid];
    const dest = lookupSessionBody(dstDir, sid);
    if (!dest || dest.turns < loc.turns || dest.bytes < loc.bytes) {
      process.stdout.write('HARVEST_UNREAD=' + sid + '|' + loc.turns + '>' + ((dest && dest.turns) || 0) + '\n');
      throw new Error('harvest-unread');
    }
  }
  if (wipe) wipeLocalSessions(home);
}

// The site's server among the tailnet peers: by its address (a Tailscale IP or a MagicDNS
// name) as the pack was built for this site.
function isSitePeer(p) {
  const site = String(OFFICE_TS_IP || '').trim().toLowerCase().replace(/\.$/, '');
  if (!p || !site || site.indexOf('{{') === 0) return false;
  const ips = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs.map(String) : [];
  if (ips.indexOf(site) >= 0) return true;
  const host = String(p.HostName || '').toLowerCase();
  const dns = String(p.DNSName || '').toLowerCase().replace(/\.$/, '');
  return dns === site || host === site || (!/^[0-9.:]+$/.test(site) && dns.split('.')[0] === site.split('.')[0]);
}

function officeViaDerp() {
  if (process.platform !== 'darwin') return false;
  const bins = [
    'tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  ];
  for (const bin of bins) {
    const r = spawnSync(bin, ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
    const text = String(r.stdout || '').trim();
    if (r.status !== 0 || text.charAt(0) !== '{') continue;
    try {
      const j = JSON.parse(text);
      const peers = j.Peer || {};
      for (const p of Object.values(peers)) {
        if (!isSitePeer(p)) continue;
        const relay = String((p && p.Relay) || '');
        // CLI "relay lax" is DERP even when CurAddr still has a stale
        // endpoint. Body copy over that path wedges cp in uninterruptible
        // SMB I/O; Node's spawnSync timeout cannot reap it.
        return relay.length > 0;
      }
    } catch { /* next bin */ }
  }
  return false;
}

function copyTimed(src, dst, ms) {
  if (!src || !dst || !fs.existsSync(src)) return 0;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const part = dst + '.part';
  try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch { /* */ }
  const r = spawnSync('cp', ['-p', src, part], {
    encoding: 'utf8',
    timeout: ms || 8000,
    killSignal: 'SIGKILL',
  });
  if (r.status !== 0) {
    try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch { /* */ }
    return 0;
  }
  try {
    if (String(dst).slice(-5) === '.zstd' && !zstdFileOk(part)) {
      try { fs.unlinkSync(part); } catch { /* */ }
      process.stdout.write('SESSION_MIRROR_BAD_ZSTD=1\n');
      return 0;
    }
    fs.renameSync(part, dst);
  } catch (e) {
    try { if (fs.existsSync(part)) fs.unlinkSync(part); } catch { /* */ }
    return 0;
  }
  return 1;
}

function shareReadMs(personal) {
  const p = path.join(roamRoot(personal), 'storages', 'workspace.json');
  const t = Date.now();
  try { fs.readFileSync(p); } catch { return 0; }
  return Date.now() - t;
}

function shareTooSlow(personal) {
  if (officeViaDerp()) return true;
  return shareReadMs(personal) >= 300;
}

function mirrorShareToLocal(home, personal) {
  // company-lease-derp-no-rsync-v1
  // Full rsync of session.jsonl over DERP SMB hangs past Node's timeout
  // (rsync --server keeps the parent alive). Splash then dumps KEY=value
  // and looks crashed. Catalog only; bodies stay on the chair / local cache.
  const roam = roamRoot(personal);
  const localLogs = countSessionLogs(path.join(home, 'sessions'));
  process.stdout.write('SESSION_MIRROR_LOCAL_LOGS=' + localLogs + '\n');
  let n = 0;
  const wsSrc = path.join(roam, 'storages', 'workspace.json');
  const wsDst = path.join(home, 'storages', 'workspace.json');
  if (fs.existsSync(wsSrc) && !fs.existsSync(wsDst)) {
    n += copyTimed(wsSrc, wsDst, 8000);
  }
  const pcSrc = path.join(roam, 'storages', 'session_projcache.json');
  const pcDst = path.join(home, 'storages', 'session_projcache.json');
  if (fs.existsSync(pcSrc) && !fs.existsSync(pcDst)) {
    n += copyTimed(pcSrc, pcDst, 8000);
  }
  process.stdout.write('SESSION_MIRROR_CATALOG=' + n + '\n');
  process.stdout.write('SESSION_MIRROR_SKIP_BODIES=1\n');
}

function mirrorShareBodiesToLocal(home, personal, opts) {
  // company-lease-slow-pin-local-v1
  // Hotspot / high-RTT: session.list reads every zstd on the chair and
  // the official UI never opens past chats. Copy bodies one file at a
  // time (no rsync). Failures skip; overlay pins local only if some landed.
  // company-lease-derp-no-body-v1: wall-clock budget. One wedged SMB cp
  // used to block splash for minutes (U-state, SIGKILL ignored).
  const roam = roamRoot(personal);
  const src = path.join(roam, 'sessions');
  const dst = path.join(home, 'sessions');
  if (!fs.existsSync(src)) {
    process.stdout.write('SESSION_MIRROR_BODIES=0\n');
    return 0;
  }
  const budget = (opts && opts.budgetMs) || 8000;
  const started = Date.now();
  let n = 0;
  let budgetHit = false;
  const walk = (from, to) => {
    if (budgetHit) return;
    let names = [];
    try { names = fs.readdirSync(from); } catch { return; }
    for (const name of names) {
      if (budgetHit) return;
      const left = budget - (Date.now() - started);
      if (left <= 0) {
        budgetHit = true;
        return;
      }
      const a = path.join(from, name);
      const b = path.join(to, name);
      let st;
      try { st = fs.lstatSync(a); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) {
        fs.mkdirSync(b, { recursive: true });
        walk(a, b);
      } else if (name === 'session.jsonl' || name === 'session.jsonl.zstd') {
        n += copyTimed(a, b, Math.min(4000, left));
      }
    }
  };
  walk(src, dst);
  if (budgetHit) process.stdout.write('SESSION_MIRROR_BODIES_BUDGET=1\n');
  process.stdout.write('SESSION_MIRROR_BODIES=' + n + '\n');
  return n;
}

function walkReplace(obj, rewrite) {
  if (Array.isArray(obj)) {
    for (const v of obj) walkReplace(v, rewrite);
    return;
  }
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if ((k === 'path' || k === 'cwd') && typeof v === 'string') obj[k] = rewrite(v);
    else walkReplace(v, rewrite);
  }
}

function mapPath(oldPath, personal, org) {
  const n = norm(oldPath);
  const wantP = norm(personal);
  const wantO = norm(org);
  if (!n) return n;
  // Keep the realpath spelling. norm() is D:/... and 0.1.7 attach rejects it.
  if (n === wantP) return chairPath(personal);
  if (wantO && n === wantO) return chairPath(org);
  const rel = companyRel(n);
  const relP = companyRel(personal);
  const relO = companyRel(org);
  const root = shareRoot(personal);
  if (rel == null) return '';
  if (rel && relP && rel === relP) return chairPath(personal);
  if (rel && relO && rel === relO) return chairPath(org);
  // Share root (empty rel) is the boss team folder. An employee team
  // folder is the dept path in org. Leftover share-root rows must land
  // on org, not stay foreign (old clients threw remap-foreign-workspace).
  if (rel === '') return (org ? chairPath(org) : '') || root;
  return '';
}

function readSessionLog(file) {
  const buf = fs.readFileSync(file);
  if (file.endsWith('.zstd')) return zlib.zstdDecompressSync(buf).toString('utf8');
  return buf.toString('utf8');
}

function writeSessionLog(file, text) {
  if (file.endsWith('.zstd')) {
    fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(text)));
    return;
  }
  fs.writeFileSync(file, text);
}

function writeShareText(file, text) {
  // smbfs rename-over-existing can sit in D on this Mac for minutes.
  // Local tmp dirs (selftest) still use rename for the usual atomic swap.
  if (process.platform === 'darwin' && String(file).indexOf('/Volumes/') < 0) {
    const n = norm(file);
    if (n.indexOf('/company/') >= 0 || n.indexOf('/dsh-company/') >= 0) {
      fs.writeFileSync(file, text);
      return;
    }
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(file); } catch { /* */ }
    fs.renameSync(tmp, file);
  }
}

function peekSessionFirstLine(file) {
  // Header only. Official zstd logs are multi-frame; Node
  // zlib.zstdDecompressSync is first-frame only — that is enough
  // for cwd. Never treat that as the full body (rewrite would
  // wipe the chat).
  if (file.endsWith('.zstd')) {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(65536);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const text = zlib.zstdDecompressSync(buf.subarray(0, n)).toString('utf8');
      const nl = text.indexOf('\n');
      return { first: nl < 0 ? text : text.slice(0, nl) };
    } finally {
      fs.closeSync(fd);
    }
  }
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16384);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const chunk = buf.toString('utf8', 0, n);
    const nl = chunk.indexOf('\n');
    if (nl < 0) return { first: chunk };
    return { first: chunk.slice(0, nl) };
  } finally {
    fs.closeSync(fd);
  }
}

function decodeSessionLogFull(file) {
  if (!file.endsWith('.zstd')) return fs.readFileSync(file, 'utf8');
  const r = spawnSync('zstd', ['-d', '-c', '--', file], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error('zstd-decode-fail');
  return r.stdout.toString('utf8');
}

function writeSessionLogFull(file, text) {
  if (!file.endsWith('.zstd')) {
    writeShareText(file, text.endsWith('\n') ? text : text + '\n');
    return;
  }
  const r = spawnSync('zstd', ['-c', '-q'], {
    input: Buffer.from(text),
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout || !r.stdout.length) throw new Error('zstd-encode-fail');
  fs.writeFileSync(file, r.stdout);
}

function remapSessionLogs(sessDir, rewrite) {
  if (!fs.existsSync(sessDir)) return 0;
  let n = 0;
  const walk = (d) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch { return; }
    for (const name of names) {
      const p = path.join(d, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (name !== 'session.jsonl' && name !== 'session.jsonl.zstd') continue;
      let peek;
      try { peek = peekSessionFirstLine(p); } catch { continue; }
      let obj;
      try { obj = JSON.parse(peek.first); } catch { continue; }
      if (!obj || obj.type !== 'session') continue;
      if (typeof obj.cwd !== 'string' || !obj.cwd) continue;
      const next = rewrite(obj.cwd);
      if (!next || next === obj.cwd) continue;
      let text;
      try {
        text = decodeSessionLogFull(p);
      } catch {
        process.stdout.write('REMAP_LOG_SKIP=' + name + '\n');
        continue;
      }
      const nl = text.indexOf('\n');
      const rest = nl < 0 ? '' : text.slice(nl);
      obj.cwd = next;
      try {
        writeSessionLogFull(p, JSON.stringify(obj) + rest);
      } catch {
        process.stdout.write('REMAP_LOG_SKIP=' + name + '\n');
        continue;
      }
      n++;
    }
  };
  walk(sessDir);
  process.stdout.write('REMAP_LOGS=' + n + '\n');
  return n;
}

function ensureSeatWorkspaces(ws, personal, org) {
  if (!ws.tables) ws.tables = {};
  if (!ws.tables.workspaces) ws.tables.workspaces = {};
  const tables = ws.tables.workspaces;
  if (!ws.global) ws.global = { initialized: true, workspaceIds: [], archivedSessionIds: [] };
  if (!Array.isArray(ws.global.workspaceIds)) ws.global.workspaceIds = [];
  const byTitle = {};
  for (const id of Object.keys(tables)) {
    const t = tables[id] && tables[id].title;
    if (t) byTitle[t] = id;
  }
  const now = new Date().toISOString();
  if (!byTitle['个人']) {
    const pid = 'w-seat-' + Date.now().toString(36);
    tables[pid] = { path: chairPath(personal), title: '个人', sessionIds: [], createdAt: now, updatedAt: now };
    ws.global.workspaceIds.push(pid);
  } else {
    tables[byTitle['个人']].path = chairPath(personal);
  }
  if (org && norm(org) !== norm(personal)) {
    if (!byTitle['团队']) {
      const oid = 'w-org-' + Date.now().toString(36);
      tables[oid] = { path: chairPath(org), title: '团队', sessionIds: [], createdAt: now, updatedAt: now };
      ws.global.workspaceIds.push(oid);
    } else {
      tables[byTitle['团队']].path = chairPath(org);
    }
  }
}

function isUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));
}

function chairPath(p) {
  // DSH attach compares record.path to fs.realpath. Slash-flipping
  // D:/... into D:\... is not that canon; realpath is.
  return livePath(p);
}

function seatKey(p) {
  const rel = companyRel(p);
  if (rel != null) return 'rel:' + String(rel).toLowerCase();
  return 'path:' + norm(p).toLowerCase();
}

function collapseSeatWorkspaces(ws, personal, org) {
  const tables = (ws.tables && ws.tables.workspaces) || {};
  const groups = {};
  for (const id of Object.keys(tables)) {
    const row = tables[id];
    if (!row || typeof row.path !== 'string') continue;
    const key = seatKey(row.path);
    if (!groups[key]) groups[key] = [];
    groups[key].push(id);
  }
  let dropped = 0;
  for (const key of Object.keys(groups)) {
    const ids = groups[key];
    let keep = ids[0];
    for (const id of ids) {
      if (isUuid(id)) keep = id;
    }
    for (const id of ids) {
      const t = tables[id] && tables[id].title;
      if ((t === '个人' || t === '团队') && isUuid(id)) keep = id;
    }
    const sids = [];
    for (const id of ids) {
      for (const sid of (tables[id].sessionIds || [])) {
        if (sids.indexOf(sid) < 0) sids.push(sid);
      }
      if (id !== keep) {
        delete tables[id];
        dropped += 1;
      }
    }
    tables[keep].sessionIds = sids;
    if (personal && key === seatKey(personal)) {
      tables[keep].title = '个人';
      tables[keep].path = chairPath(personal);
    } else if (org && key === seatKey(org)) {
      tables[keep].title = '团队';
      tables[keep].path = chairPath(org);
    }
  }
  const keepKeys = {};
  if (personal) keepKeys[seatKey(personal)] = true;
  if (org && seatKey(org) !== seatKey(personal || '')) keepKeys[seatKey(org)] = true;
  if (Object.keys(keepKeys).length) {
    for (const id of Object.keys(tables)) {
      const row = tables[id];
      if (!row || typeof row.path !== 'string') continue;
      if (!keepKeys[seatKey(row.path)]) {
        delete tables[id];
        dropped += 1;
      }
    }
  }
  if (ws.global) ws.global.workspaceIds = Object.keys(tables);
  process.stdout.write('WS_COLLAPSE=' + dropped + '\n');
  return dropped;
}

function plantCatalog(personal, org) {
  const now = new Date().toISOString();
  const pid = 'w-' + Date.now().toString(36);
  const ids = [pid];
  const tables = {};
  tables[pid] = {
    path: chairPath(personal),
    title: '个人',
    sessionIds: [],
    createdAt: now,
    updatedAt: now,
  };
  if (org && norm(org) !== norm(personal)) {
    const oid = pid + '-org';
    ids.push(oid);
    tables[oid] = {
      path: chairPath(org),
      title: '团队',
      sessionIds: [],
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ids, archivedSessionIds: [] },
    tables: { workspaces: tables },
  };
}

function workspaceIdForSlug(ws, slugName) {
  const tables = (ws.tables && ws.tables.workspaces) || {};
  for (const id of Object.keys(tables)) {
    const row = tables[id];
    if (row && typeof row.path === 'string' && slug(row.path) === slugName) return id;
  }
  return '';
}

function seatWorkspaceId(ws, title) {
  const tables = (ws.tables && ws.tables.workspaces) || {};
  for (const id of Object.keys(tables)) {
    if (tables[id] && tables[id].title === title) return id;
  }
  return '';
}

function walkSessionHomes(sessDir) {
  const homes = new Map();
  if (!sessDir || !fs.existsSync(sessDir)) return homes;
  const walk = (dir, parentSlug) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      const p = path.join(dir, name);
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (name.indexOf('session-') === 0) {
        if (!homes.has(name)) homes.set(name, parentSlug || '');
        continue;
      }
      walk(p, name.indexOf('--') === 0 ? name : parentSlug);
    }
  };
  walk(sessDir, '');
  return homes;
}

function reconcileWorkspaceSessions(ws, sessDir) {
  if (!ws || !ws.tables || !ws.tables.workspaces) return 0;
  const tables = ws.tables.workspaces;
  const order = ((ws.global && ws.global.workspaceIds) || Object.keys(tables)).filter((id) => tables[id]);
  const personalId = seatWorkspaceId(ws, '个人') || order[0] || '';
  const homes = walkSessionHomes(sessDir);
  const owner = new Map();
  for (const [sid, sl] of homes.entries()) {
    const bySlug = sl ? workspaceIdForSlug(ws, sl) : '';
    owner.set(sid, bySlug || personalId);
  }
  for (const id of order) {
    const ids = Array.isArray(tables[id].sessionIds) ? tables[id].sessionIds : [];
    for (const sid of ids) {
      if (typeof sid === 'string' && sid && !owner.has(sid)) owner.set(sid, id);
    }
  }
  let moved = 0;
  for (const id of Object.keys(tables)) {
    const prev = Array.isArray(tables[id].sessionIds) ? tables[id].sessionIds.slice() : [];
    const next = [];
    for (const [sid, wid] of owner.entries()) {
      if (wid === id && next.indexOf(sid) < 0) next.push(sid);
    }
    if (prev.join('\n') !== next.join('\n')) moved += 1;
    tables[id].sessionIds = next;
  }
  const seen = new Set();
  for (const id of order) {
    const ids = tables[id].sessionIds || [];
    for (const sid of ids) {
      if (seen.has(sid)) throw new Error('workspace-session-dup:' + sid);
      seen.add(sid);
    }
  }
  return moved;
}

function remapDesk(personal, org, rootOverride) {
  if (process.argv.indexOf('--keep-paths') < 0) {
    personal = livePath(personal) || personal;
    org = org ? (livePath(org) || org) : '';
  }
  const root = rootOverride ? norm(rootOverride) : roamRoot(personal);
  const sessDir = path.join(root, 'sessions');
  const storeDir = path.join(root, 'storages');
  fs.mkdirSync(sessDir, { recursive: true });
  fs.mkdirSync(storeDir, { recursive: true });
  const wsPath = path.join(storeDir, 'workspace.json');
  const pcPath = path.join(storeDir, 'session_projcache.json');
  if (!fs.existsSync(wsPath) || !readJsonFile(wsPath)) {
    // Do not leave REMAP_EMPTY: official UI then offers a local workspace.
    // Next login wipes desk-home and the chats from that picker are gone.
    // Empty/truncated JSON on a DERP copy also used to throw
    // "Unexpected end of JSON input" and look like 拿不到座位.
    const planted = plantCatalog(personal, org);
    fs.writeFileSync(wsPath, JSON.stringify(planted, null, 2) + '\n');
    process.stdout.write('REMAP_PLANTED=1\n');
  }
  const wsRaw = fs.readFileSync(wsPath, 'utf8');
  const ws = JSON.parse(wsRaw);
  const pairs = [];
  const tables = (ws.tables && ws.tables.workspaces) || {};
  for (const id of Object.keys(tables)) {
    const row = tables[id];
    if (!row || typeof row.path !== 'string') continue;
    const next = mapPath(row.path, personal, org);
    if (!next) {
      delete tables[id];
      process.stdout.write('REMAP_DROP=' + id + '\n');
      continue;
    }
    if (norm(row.path) !== norm(next)) pairs.push([norm(row.path), next]);
    row.path = next;
  }
  const ids = (ws.global && ws.global.workspaceIds) || [];
  if (ws.global) {
    ws.global.workspaceIds = ids.filter((id) => tables[id]);
  }
  ensureSeatWorkspaces(ws, personal, org);
  collapseSeatWorkspaces(ws, personal, org);
  const rewrite = (p) => mapPath(p, personal, org) || personal;
  walkReplace(ws, rewrite);

  if (fs.existsSync(pcPath)) {
    const pc = readJsonFile(pcPath);
    if (!pc) {
      try { fs.unlinkSync(pcPath); } catch { /* */ }
      process.stdout.write('REMAP_PC_SKIP=empty\n');
    } else {
      const pcRaw = fs.readFileSync(pcPath, 'utf8');
      walkReplace(pc, rewrite);
      const pcNext = JSON.stringify(pc, null, 2) + '\n';
      if (pcNext !== pcRaw) writeShareText(pcPath, pcNext);
    }
  }

  // Always peek headers. workspace.json may already be live
  // while session.jsonl.zstd still has the other seat's cwd —
  // official then filters every chat off the workspace.
  // Same seat as last boot: skip the SMB header walk (DERP hangs
  // splash for minutes and looks like "sessions gone").
  let sameSeat = false;
  try {
    const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    sameSeat = norm(man.personal) === norm(personal) && norm(man.org || '') === norm(org || '');
  } catch { /* first acquire on this chair */ }
  if (sameSeat) process.stdout.write('REMAP_LOGS_SKIP=1\n');
  else remapSessionLogs(sessDir, (p) => mapPath(p, personal, org));

  if (fs.existsSync(sessDir)) {
    const planned = [];
    for (const [from, to] of pairs) {
      const a = slug(from);
      const b = slug(to);
      if (a === b) continue;
      planned.push([a, b]);
    }
    for (const [a, b] of planned) {
      const src = path.join(sessDir, a);
      const dst = path.join(sessDir, b);
      if (!fs.existsSync(src)) continue;
      if (fs.existsSync(dst) && dst !== src) throw new Error('remap-slug-collision');
      fs.renameSync(src, dst);
    }
  }

  const orphans = reconcileWorkspaceSessions(ws, sessDir);
  if (orphans) process.stdout.write('REMAP_ORPHANS=' + orphans + '\n');
  const wsNext = JSON.stringify(ws, null, 2) + '\n';
  if (wsNext !== wsRaw) writeShareText(wsPath, wsNext);
  else process.stdout.write('REMAP_WS_SKIP=1\n');

  const again = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
  const check = (again.tables && again.tables.workspaces) || {};
  for (const id of Object.keys(check)) {
    const p = check[id] && check[id].path;
    if (!p) continue;
    const n = norm(p);
    if (n !== norm(personal) && n !== norm(org) && n !== shareRoot(personal)) {
      throw new Error('remap-verify-fail');
    }
  }
  writeAscii(path.join(root, 'manifest.json'), JSON.stringify({
    personal: norm(personal),
    org: norm(org),
    slug_personal: slug(personal),
    slug_org: org ? slug(org) : '',
    written_at: new Date().toISOString(),
  }, null, 2));
  process.stdout.write('REMAP_OK=1\n');
}

const INSTR_SCOPE_BLOCK =
  '- id: agent-instructions\n' +
  '  config:\n' +
  '    maxBytes: 65536\n' +
  '    projectRootMarkers:\n' +
  '      - .company-root\n';

function pinInstrScope(overlay) {
  let t = fs.readFileSync(overlay, 'utf8');
  if (/(^|\n)- id: agent-instructions\n/.test(t)) {
    t = t.replace(/(^|\n)- id: agent-instructions\n(?:  .*\n)*/m, '$1' + INSTR_SCOPE_BLOCK);
  } else if (/(^|\n)- id: skill-filesystem\n/.test(t)) {
    t = t.replace(/(^|\n)- id: skill-filesystem\n/, '$1' + INSTR_SCOPE_BLOCK + '- id: skill-filesystem\n');
  } else {
    t = t.replace(/(^|\n)- id: agent-presets\n(?:  .*\n)*/m, (m) => m + INSTR_SCOPE_BLOCK);
  }
  if (!/maxBytes: 65536/.test(t) || !/\.company-root/.test(t)) throw new Error('overlay-instr-scope');
  fs.writeFileSync(overlay, t);
  process.stdout.write('INSTR_ROOT=.company-root\n');
}

const PRESET_INSTR_MARK = 'company-preset-instr-root-v1';
const PRESET_INSTR_FROM =
  "- id: agent-instructions\n" +
  "  name: '@deepseek-ai/dsh-agent-instructions'\n" +
  "  config:\n" +
  "    maxBytes: 65536\n";
const PRESET_INSTR_TO =
  PRESET_INSTR_FROM +
  "    projectRootMarkers:\n" +
  "      - .company-root\n" +
  "# --- " + PRESET_INSTR_MARK + " ---\n";

function pinPresetInstrFile(file) {
  if (!file || !fs.existsSync(file)) return 0;
  let text = fs.readFileSync(file, 'utf8');
  if (!/id: agent-instructions/.test(text)) return 0;
  if (text.includes(PRESET_INSTR_MARK) && /\.company-root/.test(text)) return 0;
  if (/id: agent-instructions[\s\S]*?projectRootMarkers:[\s\S]*?\.company-root/.test(text)) {
    if (!text.includes(PRESET_INSTR_MARK)) {
      fs.writeFileSync(file, text.replace(/\s*$/, '') + '\n# --- ' + PRESET_INSTR_MARK + ' ---\n');
      return 1;
    }
    return 0;
  }
  const hits = text.split(PRESET_INSTR_FROM).length - 1;
  if (hits !== 1) throw new Error('preset-instr-anchor|' + file + '|got=' + hits);
  fs.writeFileSync(file, text.replace(PRESET_INSTR_FROM, PRESET_INSTR_TO));
  return 1;
}

function presetInstrDirs(home) {
  const dirs = [];
  const add = (d) => {
    if (d && fs.existsSync(d) && dirs.indexOf(d) < 0) dirs.push(d);
  };
  add(path.join(__dirname, 'prefix', 'lib', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets'));
  add(path.join(__dirname, 'prefix', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets'));
  if (home) {
    add(path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'config', 'agent-presets'));
    add(path.join(home, '.agent-presets', 'cordis'));
  }
  add(path.join(__dirname, 'presets', 'cordis'));
  return dirs;
}

function pinPresetInstrRoot(home) {
  let n = 0;
  for (const dir of presetInstrDirs(home)) {
    const names = fs.existsSync(path.join(dir, 'agent.cordis.yml'))
      ? ['agent.cordis.yml']
      : fs.readdirSync(dir).map((name) => path.join(name, 'agent.cordis.yml'));
    for (const rel of names) {
      const file = path.isAbsolute(rel) ? rel : path.join(dir, rel);
      n += pinPresetInstrFile(file);
    }
  }
  process.stdout.write('PRESET_INSTR_PIN=' + n + '\n');
  return n;
}

function plantCompanyRootMarker(personal) {
  const root = shareRoot(personal);
  if (!root) {
    process.stdout.write('COMPANY_ROOT_MARK=0\n');
    return;
  }
  const mark = path.join(root, '.company-root');
  try {
    if (!fs.existsSync(mark)) fs.writeFileSync(mark, '');
    if (!fs.existsSync(mark)) throw new Error('company-root-mark-missing');
    process.stdout.write('COMPANY_ROOT_MARK=1\n');
  } catch {
    process.stdout.write('COMPANY_ROOT_MARK=0\n');
  }
}

function themeFromSettings(text) {
  const m = String(text || '').match(/ui-theme:[\s\S]*?preference:\s*(light|dark|system)/);
  return m ? m[1] : '';
}

function applyThemeToSettings(text, pref) {
  if (!/^(light|dark|system)$/.test(pref)) return String(text || '');
  const cur = String(text || '');
  if (/ui-theme:[\s\S]*?preference:\s*(light|dark|system)/.test(cur)) {
    return cur.replace(/(ui-theme:[\s\S]*?preference:\s*)(light|dark|system)/, '$1' + pref);
  }
  return cur.replace(/\s*$/, '') + '\nui-theme:\n  preference: ' + pref + '\n';
}

function pinUserSettings(home, personal) {
  const settingsPath = path.join(home, 'settings.yaml');
  const sharePath = path.join(roamRoot(personal), 'ui-theme');
  let text = '';
  try { text = fs.readFileSync(settingsPath, 'utf8'); } catch { text = ''; }
  const fromFile = themeFromSettings(text);
  const fromShare = readTrim(sharePath);
  const pref = fromFile || fromShare;
  if (!pref) {
    process.stdout.write('USER_THEME=\n');
    return;
  }
  if (fromFile && fromFile !== fromShare) writeAscii(sharePath, fromFile);
  if (!fromFile && fromShare) {
    writeAscii(settingsPath, applyThemeToSettings(text, fromShare));
    process.stdout.write('USER_THEME_RESTORED=' + fromShare + '\n');
  }
  process.stdout.write('USER_THEME=' + pref + '\n');
}

function readOverlay(p) {
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function pinClickOneHand(overlay) {
  let t = readOverlay(overlay);
  t = t.replace(/(^|\n)- id: bridge-browser\n(?:  .*\n)*/gm, '$1');
  t = t.replace(/(^|\n)- id: ego-browser\n(?:  .*\n)*/gm, '$1');
  t = t.replace(/(^|\n)- id: company-open-browser\n(?:  .*\n)*/gm, '$1');
  t = t.replace(/\n{3,}/g, '\n\n');
  if (t.indexOf('company-click-one-hand-v1') < 0) t = '# company-click-one-hand-v1\n' + t;
  const block =
    '- id: bridge-browser\n  disabled: true\n  config:\n    sessionWorkspacePath: ""\n    deferSessionCreate: true\n- id: ego-browser\n  name: ego-browser\n  disabled: true\n- id: company-open-browser\n  disabled: true\n';
  if (!/- id: ego-browser\n  name: ego-browser\n  disabled: true/.test(t)) {
    const i = t.indexOf('- id: ');
    if (i < 0) t += (t.endsWith('\n') ? '' : '\n') + block;
    else t = t.slice(0, i) + block + t.slice(i);
  }
  fs.writeFileSync(overlay, t);
  process.stdout.write('CLICK_ONE_HAND=1\n');
}

function pinRoleUi(overlay, role) {
  let t = readOverlay(overlay);
  const admin = role === 'admin';
  const sub =
    '- id: llm-subscriptions\n' +
    '  disabled: true\n';
  const fast = admin
    ? '- id: grok-fast-mode\n'
    : '- id: grok-fast-mode\n  disabled: true\n';
  if (!/(^|\n)- id: llm-subscriptions\n/.test(t)) {
    t = t.replace(/(^|\n)- id: agent-presets\n/, '$1' + sub + '- id: agent-presets\n');
  } else {
    t = t.replace(/(^|\n)- id: llm-subscriptions\n(?:  .*\n)*/m, '$1' + sub);
  }
  if (!/(^|\n)- id: grok-fast-mode\n/.test(t)) {
    t = t.replace(/(^|\n)- id: llm-subscriptions\n(?:  .*\n)*/m, (m) => m + fast);
  } else {
    t = t.replace(/(^|\n)- id: grok-fast-mode\n(?:  .*\n)*/m, '$1' + fast);
  }
  if (!/- id: llm-subscriptions\n  disabled: true/.test(t)) throw new Error('overlay-sub-pin');
  if (admin) {
    if (!/- id: grok-fast-mode\n/.test(t)) throw new Error('overlay-fast-pin-admin');
    if (/- id: grok-fast-mode\n  disabled: true/.test(t)) throw new Error('overlay-fast-still-off');
  } else if (!/- id: grok-fast-mode\n  disabled: true/.test(t)) {
    throw new Error('overlay-fast-pin-emp');
  }
  fs.writeFileSync(overlay, t);
  process.stdout.write('ROLE_UI_FAST=' + (admin ? '1' : '0') + '\n');
  process.stdout.write('ROLE_UI_SUB=0\n');
}

function pinPresetRoot(overlay, role) {
  let t = readOverlay(overlay);
  const allow = canAuthorPresets(role);
  const block =
    '- id: agent-presets\n  config:\n    default: standard\n    includeUserRoot: ' +
    (allow ? 'true' : 'false') + '\n';
  if (!/(^|\n)- id: agent-presets\n/.test(t)) {
    t = block + t;
  } else {
    t = t.replace(/(^|\n)- id: agent-presets\n(?:  .*\n)*/m, '$1' + block);
  }
  fs.writeFileSync(overlay, t);
  process.stdout.write('PRESET_USER_ROOT=' + (allow ? '1' : '0') + '\n');
}

function bundledCordis() {
  return path.join(__dirname, 'presets', 'cordis');
}

function pinAgentPresets(home, role) {
  const allow = canAuthorPresets(role);
  const dest = path.join(home, '.agent-presets', 'cordis');
  const src = bundledCordis();
  if (!allow) {
    process.stdout.write('PRESET_CORDIS=0\n');
    return;
  }
  if (!fs.existsSync(path.join(src, 'preset.yml'))) {
    process.stdout.write('PRESET_CORDIS_SKIP=1\n');
    return;
  }
  fs.cpSync(src, dest, { recursive: true });
  process.stdout.write('PRESET_CORDIS=1\n');
}

function pinOverlay(overlay, personal, localHome) {
  const root = localHome ? localHome : roamRoot(personal);
  const sessions = path.join(root, 'sessions');
  const storages = path.join(root, 'storages');
  let t = fs.readFileSync(overlay, 'utf8');
  t = t.replace(/(^|\n)- id: session-persistence-jsonl\n(?:  .*\n)*/m, '$1');
  t = t.replace(/(^|\n)- id: storage-json\n(?:  .*\n)*/m, '$1');
  const block =
    '- id: session-persistence-jsonl\n  config:\n    root: ' + yamlRoot(sessions) + '\n' +
    '- id: storage-json\n  config:\n    root: ' + yamlRoot(storages) + '\n';
  const i = t.indexOf('- id: ');
  if (i < 0) throw new Error('overlay-no-rows');
  fs.writeFileSync(overlay, t.slice(0, i) + block + t.slice(i));
  if (!t.includes('session-query-sqlite') && t.includes("openAt:")) {
    /* keep official never/memory from base; do not add a file sqlite */
  }
  process.stdout.write('OVERLAY_SESSIONS=' + norm(sessions) + '\n');
  process.stdout.write('OVERLAY_STORAGES=' + norm(storages) + '\n');
}

async function postLease(action) {
  const tok = token();
  if (!tok || tok === 'company-gateway') throw new Error('gw-token-required');
  const { status, data } = await requestJson('POST', leaseUrl(), {
    action,
    device_id: deviceId(),
  }, tok);
  return { status, data };
}

function bootStatusPath() {
  return path.join(rcDir(), 'desk-boot.status');
}

function writeBoot(status) {
  writeAscii(bootStatusPath(), status);
}

function seatNote(why) {
  if (why === 'flush' || why === 'kicked') return NOTE_OTHER;
  return NOTE_EXPIRED;
}

function notify(msg) {
  writeAscii(path.join(rcDir(), 'lease.note'), msg);
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'display dialog ' + JSON.stringify(msg) + ' buttons {"OK"} with title "TDHarness"'], { stdio: 'ignore' });
  }
}

function deskUp() {
  return new Promise((resolve) => {
    const s = require('net').connect({ host: '127.0.0.1', port: DESK_PORT }, () => {
      s.end();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.setTimeout(400, () => { s.destroy(); resolve(false); });
  });
}

function stopDesk() {
  if (process.platform === 'darwin') {
    const r = spawnSync('lsof', ['-nP', '-t', '-iTCP:' + DESK_PORT, '-sTCP:LISTEN'], { encoding: 'utf8' });
    for (const pid of String(r.stdout || '').split(/\s+/).filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGTERM'); } catch { /* gone */ }
    }
    return;
  }
  spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    "Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort " + DESK_PORT + " -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
  ], { stdio: 'ignore' });
}

async function cmdAcquire() {
  const personal = personalPath();
  const org = orgPath();
  const home = deskHome();
  if (!personal || !fs.existsSync(personal)) throw new Error('company-workspace-missing');
  assertShareWritable(personal);
  const derp = officeViaDerp();
  const slowShare = derp || shareTooSlow(personal);
  if (derp) process.stdout.write('SHARE_VIA_DERP=1\n');
  if (slowShare && !derp) process.stdout.write('SHARE_TOO_SLOW=1\n');
  harvestThenWipe(home, personal, { wipe: !slowShare, skipShare: slowShare });
  if (slowShare) {
    try { mirrorShareToLocal(home, personal); } catch (e) {
      process.stdout.write('SESSION_MIRROR_SKIP=' + ((e && e.message) || e) + '\n');
    }
    // DERP / relay: catalog only. Body copy wedges splash (cp U-state).
    if (derp) {
      process.stdout.write('SESSION_MIRROR_BODIES_SKIP=derp\n');
    } else {
      try { mirrorShareBodiesToLocal(home, personal, { budgetMs: 8000 }); } catch (e) {
        process.stdout.write('SESSION_MIRROR_BODIES_SKIP=' + ((e && e.message) || e) + '\n');
      }
    }
  }
  const started = Date.now();
  let last = '';
  try {
    while (Date.now() - started < KICK_WAIT_MS) {
      const { status, data } = await postLease('acquire');
      last = (data && data.status) || '';
      process.stdout.write('LEASE_STATUS=' + last + '\n');
      if (status === 200 && (last === 'granted' || last === 'held')) {
        const ov = path.join(home, 'profiles', 'web', 'overlay.yml');
        const role = loginRole();
        // company-lease-catalog-follows-pin-v1
        let localPin = false;
        if (fs.existsSync(ov)) {
          // Slow share (DERP or hotspot RTT): pin local only after bodies
          // landed. Empty local pin = empty sidebar. Fast share stays chair.
          sweepBadLocalZstd(home);
          localPin = slowShare && countSessionLogs(path.join(home, 'sessions')) > 0;
          pinOverlay(ov, personal, localPin ? home : '');
          if (localPin) process.stdout.write('OVERLAY_PIN_LOCAL=1\n');
          pinPresetRoot(ov, role);
          pinInstrScope(ov);
          pinPresetInstrRoot(home);
          pinRoleUi(ov, role);
          pinClickOneHand(ov);
        }
        remapDesk(personal, org, localPin ? home : '');
        plantCompanyRootMarker(personal);
        pinUserSettings(home, personal);
        pinAgentPresets(home, role);
        process.stdout.write('LEASE_GRANTED=1\n');
        process.stdout.write('DIRTY=' + (data.dirty ? '1' : '0') + '\n');
        process.stdout.write('GENERATION=' + String(data.generation || 0) + '\n');
        if (data.dirty) process.stdout.write('LEASE_DIRTY=1\n');
        return;
      }
      if (status === 401 || status === 404) throw new Error('lease-api-' + status);
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('lease-timeout');
  } catch (e) {
    try { await postLease('release'); } catch { /* */ }
    throw e;
  }
}

async function cmdHeartbeat() {
  const { status, data } = await postLease('heartbeat');
  process.stdout.write('LEASE_STATUS=' + ((data && data.status) || '') + '\n');
  if (status >= 400) process.exit(status === 409 ? 3 : 2);
}

async function cmdRelease() {
  try { await postLease('release'); } catch { /* gone */ }
  process.stdout.write('LEASE_RELEASED=1\n');
}

async function cmdFlushed() {
  const { data } = await postLease('flushed');
  process.stdout.write('LEASE_STATUS=' + ((data && data.status) || '') + '\n');
}

async function cmdWatch() {
  const pidFile = path.join(rcDir(), 'lease-watch.pid');
  writeAscii(pidFile, String(process.pid));
  const stop = async (why) => {
    process.stdout.write('WATCH_STOP=' + why + '\n');
    const boot = (why === 'flush' || why === 'kicked') ? 'kicked' : (why === 'desk-down' ? 'desk-down' : why);
    writeBoot(boot === 'signal' ? 'desk-down' : boot);
    notify(seatNote(why));
    if (why === 'flush' || why === 'kicked') {
      stopDesk();
      if (why === 'flush') {
        try { await postLease('flushed'); } catch { /* */ }
      }
      try { fs.unlinkSync(pidFile); } catch { /* */ }
      process.exit(3);
    }
    if (why === 'desk-down') {
      try { fs.unlinkSync(pidFile); } catch { /* */ }
      process.exit(0);
    }
    try { await postLease('release'); } catch { /* */ }
    try { fs.unlinkSync(pidFile); } catch { /* */ }
    process.exit(0);
  };
  process.on('SIGTERM', () => { stop('signal').catch(() => process.exit(0)); });
  process.on('SIGINT', () => { stop('signal').catch(() => process.exit(0)); });
  let lastName = null;
  while (true) {
    let status = 0;
    let name = '';
    let hit = null;
    try {
      hit = await postLease('heartbeat');
      status = hit.status;
      name = (hit.data && hit.data.status) || '';
    } catch (err) {
      process.stdout.write('LEASE_HB_FAIL=' + (err && err.message ? err.message : 'error') + '\n');
      lastName = null;
      await new Promise((r) => setTimeout(r, HEARTBEAT_RETRY_MS));
      continue;
    }
    // company-lease-derp-hb-v1: log only on change; 89k `held` lines bloated lease-watch.log to 1.6MB.
    if (name !== lastName) process.stdout.write('LEASE_STATUS=' + name + '\n');
    lastName = name;
    if (name === 'flush') { await stop('flush'); return; }
    if (status === 409 || name === 'kicked') { await stop('kicked'); return; }
    // company-lease-desk-down-confirm-v1: stop('desk-down') wipes gw.token /
    // smb.pass, so the next open costs a re-login. One missed 400ms loopback
    // probe (swap, GC pause) is not proof the desk is gone: confirm 3 times.
    if (!(await deskUp())) {
      let gone = true;
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        if (await deskUp()) { gone = false; break; }
      }
      if (gone) { await stop('desk-down'); return; }
      process.stdout.write('DESK_PROBE_RECOVERED=1\n');
    }
    await new Promise((r) => setTimeout(r, HEARTBEAT_MS));
  }
}

function cmdSelftest() {
  const a = '/Users/x/company/content/emp-alice';
  const b = '\\\\10.9.8.7\\dsh-company\\content\\emp-alice';
  if (companyRel(a) !== 'content/emp-alice') throw new Error('rel-mac');
  if (companyRel(b) !== 'content/emp-alice') throw new Error('rel-win');
  if (mapPath(a, b, '\\\\10.9.8.7\\dsh-company\\content') !== norm(b)) throw new Error('map-mac-win');
  if (slug(a) !== '--Users-x-company-content-emp-alice--') throw new Error('slug-mac');
  if (slug(b) !== '--10.9.8.7-dsh-company-content-emp-alice--') throw new Error('slug-unc');
  if (slug('D:\\dsh\\company\\content\\emp-alice') !== '--D-dsh-company-content-emp-alice--') throw new Error('slug-drive');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-remap-'));
  const pers = path.join(tmp, 'company', 'content', 'emp-alice');
  const org = path.join(tmp, 'company', 'content');
  fs.mkdirSync(path.join(pers, '.dsh-desk', 'sessions', slug(a)), { recursive: true });
  fs.mkdirSync(path.join(pers, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(pers, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w1'] },
    tables: { workspaces: { w1: { path: a, title: '个人' } } },
  }));
  remapDesk(pers, org);
  const ws = JSON.parse(fs.readFileSync(path.join(pers, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  if (norm(ws.tables.workspaces.w1.path) !== norm(livePath(pers))) throw new Error('selftest-path');
  if (!fs.existsSync(path.join(pers, '.dsh-desk', 'sessions', slug(livePath(pers))))) throw new Error('selftest-slug');
  fs.rmSync(tmp, { recursive: true, force: true });

  const boxWin = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mac-win-'));
  const winPers = path.join(boxWin, 'dsh-company', 'content', 'emp-alice');
  const winOrg = path.join(boxWin, 'dsh-company', 'content');
  const macSlug = slug(a);
  const sid = 'session-keep-win';
  fs.mkdirSync(path.join(winPers, '.dsh-desk', 'sessions', macSlug, sid), { recursive: true });
  fs.mkdirSync(path.join(winPers, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(winPers, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w1', 'w2'] },
    tables: {
      workspaces: {
        w1: { path: a, title: '个人', sessionIds: [sid] },
        w2: { path: '/Users/x/company/content', title: '团队', sessionIds: [] },
      },
    },
  }));
  const rawLog = JSON.stringify({
    type: 'session', version: 2, id: sid, createdAt: 1, cwd: a, delegationDepth: 0,
  }) + '\n{"type":"user","text":"keep"}\n';
  fs.writeFileSync(path.join(winPers, '.dsh-desk', 'sessions', macSlug, sid, 'session.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(rawLog)));
  remapDesk(winPers, winOrg);
  const wsWin = JSON.parse(fs.readFileSync(path.join(winPers, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  if (norm(wsWin.tables.workspaces.w1.path) !== norm(livePath(winPers))) throw new Error('selftest-win-path');
  if (norm(wsWin.tables.workspaces.w2.path) !== norm(livePath(winOrg))) throw new Error('selftest-win-org');
  const moved = path.join(winPers, '.dsh-desk', 'sessions', slug(livePath(winPers)), sid, 'session.jsonl.zstd');
  if (!fs.existsSync(moved)) throw new Error('selftest-win-slug');
  if (fs.existsSync(path.join(winPers, '.dsh-desk', 'sessions', macSlug))) throw new Error('selftest-win-old-slug');
  const hdr = JSON.parse(readSessionLog(moved).split('\n')[0]);
  if (norm(hdr.cwd) !== norm(livePath(winPers))) throw new Error('selftest-win-cwd');
  fs.rmSync(boxWin, { recursive: true, force: true });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-wipe-'));
  fs.mkdirSync(path.join(home, 'sessions', 'x'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 'x', 'f'), '1');
  wipeLocalSessions(home);
  if (fs.existsSync(path.join(home, 'sessions'))) throw new Error('selftest-wipe');
  fs.rmSync(home, { recursive: true, force: true });
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harvest-'));
  const pers2 = path.join(box, 'company', 'content', 'emp-alice');
  const home2 = path.join(box, 'desk-home');
  fs.mkdirSync(path.join(home2, 'sessions', '--Users-x-company-content-emp-alice--', 'session-keep'), { recursive: true });
  fs.writeFileSync(path.join(home2, 'sessions', '--Users-x-company-content-emp-alice--', 'session-keep', 'session.jsonl'), 'keep\n');
  fs.mkdirSync(path.join(home2, 'storages'), { recursive: true });
  fs.writeFileSync(path.join(home2, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w2'] },
    tables: { workspaces: { w2: { path: pers2, title: '个人', sessionIds: ['session-keep'] } } },
  }));
  harvestThenWipe(home2, pers2);
  const kept = path.join(pers2, '.dsh-desk', 'sessions', '--Users-x-company-content-emp-alice--', 'session-keep', 'session.jsonl');
  if (!fs.existsSync(kept)) throw new Error('selftest-harvest-file');
  if (fs.existsSync(path.join(home2, 'sessions'))) throw new Error('selftest-harvest-wipe');
  if (!workspaceHasSessions(path.join(pers2, '.dsh-desk', 'storages', 'workspace.json'))) throw new Error('selftest-harvest-ws');
  fs.rmSync(box, { recursive: true, force: true });
  const boxMerge = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harvest-merge-'));
  const persM = path.join(boxMerge, 'company', 'content', 'emp-zhang');
  const homeM = path.join(boxMerge, 'desk-home');
  fs.mkdirSync(path.join(homeM, 'sessions', 'local-slug', 'session-local'), { recursive: true });
  fs.writeFileSync(path.join(homeM, 'sessions', 'local-slug', 'session-local', 'session.jsonl'), 'local-history\n');
  fs.mkdirSync(path.join(homeM, 'storages'), { recursive: true });
  fs.writeFileSync(path.join(homeM, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w2'] },
    tables: { workspaces: { w2: { path: persM, title: '个人', sessionIds: ['session-local'] } } },
  }));
  fs.mkdirSync(path.join(persM, '.dsh-desk', 'sessions', 'share-slug', 'session-share'), { recursive: true });
  fs.writeFileSync(path.join(persM, '.dsh-desk', 'sessions', 'share-slug', 'session-share', 'session.jsonl'), 'share\n');
  fs.mkdirSync(path.join(persM, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(persM, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w2'] },
    tables: { workspaces: { w2: { path: persM, title: '个人', sessionIds: ['session-share'] } } },
  }));
  harvestThenWipe(homeM, persM);
  const wsM = JSON.parse(fs.readFileSync(path.join(persM, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  const idsM = wsM.tables.workspaces.w2.sessionIds || [];
  if (idsM.indexOf('session-share') < 0 || idsM.indexOf('session-local') < 0) throw new Error('selftest-harvest-merge');
  if (!fs.existsSync(path.join(persM, '.dsh-desk', 'sessions', 'local-slug', 'session-local', 'session.jsonl'))) {
    throw new Error('selftest-harvest-keep-local-file');
  }
  if (fs.existsSync(path.join(homeM, 'sessions'))) throw new Error('selftest-harvest-merge-wipe');
  fs.rmSync(boxMerge, { recursive: true, force: true });
  const boxRich = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-harvest-rich-'));
  const persR = path.join(boxRich, 'company', 'content', 'emp-rich');
  const homeR = path.join(boxRich, 'desk-home');
  const sidR = 'session-rich-lock';
  const headerR = JSON.stringify({ type: 'session', cwd: '/tmp/rich' });
  fs.mkdirSync(path.join(homeR, 'sessions', 'slug-r', sidR), { recursive: true });
  fs.mkdirSync(path.join(homeR, 'storages'), { recursive: true });
  fs.writeFileSync(path.join(homeR, 'sessions', 'slug-r', sidR, 'session.jsonl'), headerR + '\n' + '{"type":"turn"}\n'.repeat(8));
  fs.writeFileSync(path.join(homeR, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w2'] },
    tables: { workspaces: { w2: { path: persR, title: '个人', sessionIds: [sidR] } } },
  }));
  fs.mkdirSync(path.join(persR, '.dsh-desk', 'sessions', 'slug-r', sidR), { recursive: true });
  fs.mkdirSync(path.join(persR, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(persR, '.dsh-desk', 'sessions', 'slug-r', sidR, 'session.jsonl'), headerR + '\n' + ' '.repeat(4000) + '\n');
  fs.writeFileSync(path.join(persR, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w2'] },
    tables: { workspaces: { w2: { path: persR, title: '个人', sessionIds: [sidR] } } },
  }));
  harvestThenWipe(homeR, persR);
  const keptR = path.join(persR, '.dsh-desk', 'sessions', 'slug-r', sidR, 'session.jsonl');
  if (sessionLogTurns(keptR) < 8) throw new Error('selftest-rich-not-copied');
  if (fs.existsSync(path.join(homeR, 'sessions'))) throw new Error('selftest-rich-local-kept');
  fs.rmSync(boxRich, { recursive: true, force: true });
  const boxU = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-unread-'));
  const persU = path.join(boxU, 'company', 'content', 'emp-u');
  const homeU = path.join(boxU, 'desk-home');
  const sidU = 'session-unread-lock';
  const headerU = JSON.stringify({ type: 'session', cwd: '/tmp/u' });
  const localU = path.join(homeU, 'sessions', 'slug-u', sidU);
  const destU = path.join(persU, '.dsh-desk', 'sessions', 'slug-u', sidU);
  fs.mkdirSync(localU, { recursive: true });
  fs.mkdirSync(path.join(homeU, 'storages'), { recursive: true });
  fs.mkdirSync(destU, { recursive: true });
  fs.writeFileSync(path.join(localU, 'session.jsonl'), headerU + '\n' + '{"type":"turn"}\n'.repeat(8));
  fs.writeFileSync(path.join(homeU, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w2'] },
    tables: { workspaces: { w2: { path: persU, title: '个人', sessionIds: [sidU] } } },
  }));
  fs.writeFileSync(path.join(destU, 'session.jsonl'), headerU + '\n');
  try { fs.chmodSync(path.join(destU, 'session.jsonl'), 0o444); } catch { /* ok */ }
  try { fs.chmodSync(destU, 0o555); } catch { /* ok */ }
  let unreadThrew = false;
  try {
    harvestThenWipe(homeU, persU);
  } catch (e) {
    const msg = String((e && e.message) || e);
    unreadThrew = msg.indexOf('harvest-unread') >= 0 || msg.indexOf('EACCES') >= 0 || msg.indexOf('EPERM') >= 0;
  }
  if (!unreadThrew) throw new Error('selftest-unread-no-throw');
  if (!fs.existsSync(path.join(localU, 'session.jsonl'))) throw new Error('selftest-unread-wiped');
  try { fs.chmodSync(destU, 0o755); } catch { /* ok */ }
  try { fs.chmodSync(path.join(destU, 'session.jsonl'), 0o644); } catch { /* ok */ }
  fs.rmSync(boxU, { recursive: true, force: true });
  const boxSkip = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-skip-dest-'));
  const persSkip = path.join(boxSkip, 'company', 'content', 'emp-skip');
  const homeSkip = path.join(boxSkip, 'desk-home');
  fs.mkdirSync(homeSkip, { recursive: true });
  const fatSkip = path.join(persSkip, '.dsh-desk', 'sessions', 'slug-fat', 'session-fat');
  fs.mkdirSync(fatSkip, { recursive: true });
  fs.writeFileSync(path.join(fatSkip, 'session.jsonl'), 'fat\n' + 'x'.repeat(80000) + '\n');
  harvestThenWipe(homeSkip, persSkip);
  if (!fs.existsSync(path.join(fatSkip, 'session.jsonl'))) throw new Error('selftest-skip-dest-clobbered');
  if (fs.existsSync(path.join(homeSkip, 'sessions'))) throw new Error('selftest-skip-dest-local');
  fs.rmSync(boxSkip, { recursive: true, force: true });
  const boxEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-empty-cat-'));
  const persE = path.join(boxEmpty, 'company', 'content', 'emp-new');
  const orgE = path.join(boxEmpty, 'company', 'content');
  fs.mkdirSync(path.join(persE, '.dsh-desk', 'sessions'), { recursive: true });
  remapDesk(persE, orgE);
  const wsE = JSON.parse(fs.readFileSync(path.join(persE, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  const titles = Object.keys(wsE.tables.workspaces).map((id) => wsE.tables.workspaces[id].title).sort();
  if (titles.join(',') !== '个人,团队') throw new Error('selftest-plant-titles');
  wsE.tables.workspaces.dup = {
    path: persE,
    title: '_office',
    sessionIds: ['session-dup'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  collapseSeatWorkspaces(wsE, persE, orgE);
  const after = Object.keys(wsE.tables.workspaces).map((id) => wsE.tables.workspaces[id].title).sort();
  if (after.join(',') !== '个人,团队') throw new Error('selftest-collapse-titles');
  const persRow = Object.keys(wsE.tables.workspaces).map((id) => wsE.tables.workspaces[id]).find((r) => r.title === '个人');
  if (!persRow || (persRow.sessionIds || []).indexOf('session-dup') < 0) throw new Error('selftest-collapse-merge');
  fs.rmSync(boxEmpty, { recursive: true, force: true });
  const boxW = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-writable-'));
  const persW = path.join(boxW, 'p');
  fs.mkdirSync(persW);
  assertShareWritable(persW);
  if (!fs.existsSync(path.join(persW, '.dsh-desk', 'sessions'))) throw new Error('selftest-writable');
  fs.rmSync(boxW, { recursive: true, force: true });
  const boxB = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-boss-root-'));
  const persB = path.join(boxB, 'company', '_office');
  const orgB = path.join(boxB, 'company');
  fs.mkdirSync(path.join(persB, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(persB, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['w1', 'w2'] },
    tables: {
      workspaces: {
        w1: { path: 'D:/dsh/company/_office', title: '个人', sessionIds: [] },
        w2: { path: 'D:/dsh/company', title: '团队', sessionIds: [] },
      },
    },
  }));
  remapDesk(persB, orgB);
  const wsB = JSON.parse(fs.readFileSync(path.join(persB, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  if (norm(wsB.tables.workspaces.w1.path) !== norm(livePath(persB))) throw new Error('selftest-boss-personal');
  if (norm(wsB.tables.workspaces.w2.path) !== norm(livePath(orgB))) throw new Error('selftest-boss-org-root');
  fs.rmSync(boxB, { recursive: true, force: true });
  const boxF = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-drop-chair-'));
  const persF = path.join(boxF, 'company', '_office');
  const orgF = path.join(boxF, 'company');
  fs.mkdirSync(path.join(persF, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(persF, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['w1', 'w2', 'w3'] },
    tables: {
      workspaces: {
        w1: { path: 'D:/dsh/company/_office', title: '个人', sessionIds: [] },
        w2: { path: 'D:/dsh/company/content', title: '团队', sessionIds: [] },
        w3: { path: 'D:/dsh/company/content/emp-bob', title: '别人', sessionIds: [] },
      },
    },
  }));
  remapDesk(persF, orgF);
  const wsF = JSON.parse(fs.readFileSync(path.join(persF, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  const titlesF = Object.keys(wsF.tables.workspaces).map((id) => wsF.tables.workspaces[id].title).sort();
  if (titlesF.join(',') !== '个人,团队') throw new Error('selftest-drop-foreign');
  const teamF = Object.values(wsF.tables.workspaces).find((r) => r.title === '团队');
  if (!teamF || norm(teamF.path) !== norm(livePath(orgF))) throw new Error('selftest-seat-org');
  if (wsF.tables.workspaces.w3) throw new Error('selftest-kept-foreign');
  const boxQ = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bob-root-'));
  const persQ = path.join(boxQ, 'company', 'content', 'emp-bob');
  const orgQ = path.join(boxQ, 'company', 'content');
  fs.mkdirSync(path.join(persQ, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(persQ, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['w1', 'w2'] },
    tables: {
      workspaces: {
        w1: { path: '//{{TDH_HOST}}/dsh-company/content/emp-bob', title: '个人', sessionIds: [] },
        w2: { path: '//{{TDH_HOST}}/dsh-company', title: '团队', sessionIds: [] },
      },
    },
  }));
  remapDesk(persQ, orgQ);
  const wsQ = JSON.parse(fs.readFileSync(path.join(persQ, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  const persRowQ = Object.values(wsQ.tables.workspaces).find((r) => r.title === '个人');
  const teamQ = Object.values(wsQ.tables.workspaces).find((r) => r.title === '团队');
  if (!persRowQ || norm(persRowQ.path) !== norm(livePath(persQ))) throw new Error('selftest-emp-personal-ts');
  if (!teamQ || norm(teamQ.path) !== norm(livePath(orgQ))) throw new Error('selftest-emp-share-root');
  fs.rmSync(boxQ, { recursive: true, force: true });
  const boxI = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-instr-'));
  const ovI = path.join(boxI, 'overlay.yml');
  fs.writeFileSync(ovI, '- id: agent-presets\n  config:\n    default: standard\n    includeUserRoot: true\n- id: skill-filesystem\n  config:\n    includeDefaultRoots: false\n');
  pinInstrScope(ovI);
  const pinned = fs.readFileSync(ovI, 'utf8');
  if (!/maxBytes: 65536/.test(pinned) || !/\.company-root/.test(pinned)) throw new Error('selftest-instr-pin');
  const boxPreset = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preset-instr-'));
  const presetF = path.join(boxPreset, 'agent.cordis.yml');
  fs.writeFileSync(presetF, PRESET_INSTR_FROM + '\n- id: tool-bash\n');
  if (pinPresetInstrFile(presetF) !== 1) throw new Error('selftest-preset-instr-pin');
  const pinnedPreset = fs.readFileSync(presetF, 'utf8');
  if (!/\.company-root/.test(pinnedPreset) || !pinnedPreset.includes(PRESET_INSTR_MARK)) throw new Error('selftest-preset-instr-mark');
  if (pinPresetInstrFile(presetF) !== 0) throw new Error('selftest-preset-instr-again');
  fs.rmSync(boxPreset, { recursive: true, force: true });
  if (!/includeUserRoot: true/.test(pinned)) throw new Error('selftest-instr-keep-user-root');
  const shareI = path.join(boxI, 'company');
  fs.mkdirSync(path.join(shareI, '_office'), { recursive: true });
  plantCompanyRootMarker(path.join(shareI, '_office'));
  if (!fs.existsSync(path.join(shareI, '.company-root'))) throw new Error('selftest-company-root-mark');
  fs.rmSync(boxI, { recursive: true, force: true });
  fs.rmSync(boxF, { recursive: true, force: true });
  const boxDup = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-dup-'));
  const persD = path.join(boxDup, 'company', '_office');
  const orgD = path.join(boxDup, 'company');
  const sidD = 'session-c89ba1af-28c5-484e-82f4-1a46b1f5f45d';
  fs.mkdirSync(path.join(persD, '.dsh-desk', 'sessions', slug(orgD), sidD), { recursive: true });
  fs.mkdirSync(path.join(persD, '.dsh-desk', 'storages'), { recursive: true });
  fs.writeFileSync(path.join(persD, '.dsh-desk', 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['w1', 'w2'], archivedSessionIds: [] },
    tables: {
      workspaces: {
        w1: { path: persD, title: '个人', sessionIds: [sidD] },
        w2: { path: orgD, title: '团队', sessionIds: [sidD] },
      },
    },
  }));
  remapDesk(persD, orgD);
  const wsD = JSON.parse(fs.readFileSync(path.join(persD, '.dsh-desk', 'storages', 'workspace.json'), 'utf8'));
  const personalD = Object.values(wsD.tables.workspaces).find((r) => r.title === '个人');
  const teamD = Object.values(wsD.tables.workspaces).find((r) => r.title === '团队');
  if (!teamD || teamD.sessionIds.indexOf(sidD) < 0) throw new Error('selftest-dup-keep-team');
  if (personalD && personalD.sessionIds.indexOf(sidD) >= 0) throw new Error('selftest-dup-still-personal');
  fs.rmSync(boxDup, { recursive: true, force: true });
  const boxP = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-preset-pin-'));
  const ovP = path.join(boxP, 'overlay.yml');
  fs.writeFileSync(ovP, '- id: agent-presets\n  config:\n    default: standard\n    includeUserRoot: false\n- id: other\n  config:\n    x: 1\n');
  pinPresetRoot(ovP, 'admin');
  const ovAdmin = fs.readFileSync(ovP, 'utf8');
  if (!/includeUserRoot: true/.test(ovAdmin)) throw new Error('selftest-preset-admin');
  pinPresetRoot(ovP, 'employee');
  const ovEmp = fs.readFileSync(ovP, 'utf8');
  if (!/includeUserRoot: false/.test(ovEmp)) throw new Error('selftest-preset-emp');
  if (!canAuthorPresets('director') || canAuthorPresets('bob')) throw new Error('selftest-preset-role');
  fs.writeFileSync(ovP, '- id: other\r\n  config:\r\n    x: 1\r\n');
  pinPresetRoot(ovP, 'employee');
  const ovInsert = fs.readFileSync(ovP, 'utf8');
  if (!/(^|\n)- id: agent-presets\n  config:\n    default: standard\n    includeUserRoot: false\n/.test(ovInsert)) {
    throw new Error('selftest-preset-insert-crlf');
  }
  fs.writeFileSync(ovP, '- id: agent-presets\n  config:\n    default: standard\n    includeUserRoot: false\n- id: llm-subscriptions\n  disabled: true\n- id: grok-fast-mode\n  disabled: true\n');
  pinRoleUi(ovP, 'admin');
  const ovFastAdmin = fs.readFileSync(ovP, 'utf8');
  if (!/- id: grok-fast-mode\n/.test(ovFastAdmin)) throw new Error('selftest-fast-admin-missing');
  if (/- id: grok-fast-mode\n  disabled: true/.test(ovFastAdmin)) throw new Error('selftest-fast-admin-off');
  if (!/- id: llm-subscriptions\n  disabled: true/.test(ovFastAdmin)) throw new Error('selftest-sub-still-on');
  pinRoleUi(ovP, 'employee');
  const ovFastEmp = fs.readFileSync(ovP, 'utf8');
  if (!/- id: grok-fast-mode\n  disabled: true/.test(ovFastEmp)) throw new Error('selftest-fast-emp');
  fs.writeFileSync(ovP, '- id: ego-browser\n  name: ego-browser\n- id: other\n  config:\n    x: 1\n');
  pinClickOneHand(ovP);
  const ovClick = fs.readFileSync(ovP, 'utf8');
  if (!/- id: ego-browser\n  name: ego-browser\n  disabled: true/.test(ovClick)) throw new Error('selftest-click-ego');
  if (!/- id: bridge-browser\n  disabled: true/.test(ovClick)) throw new Error('selftest-click-bridge');
  if (!/- id: company-open-browser\n  disabled: true/.test(ovClick)) throw new Error('selftest-click-open');
  const boxT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-theme-lock-'));
  const homeT = path.join(boxT, 'home');
  const persT = path.join(boxT, 'company', '_office');
  fs.mkdirSync(homeT, { recursive: true });
  fs.mkdirSync(persT, { recursive: true });
  fs.writeFileSync(path.join(homeT, 'settings.yaml'), 'locale:\n  preference: zh\n');
  pinUserSettings(homeT, persT);
  if (themeFromSettings(fs.readFileSync(path.join(homeT, 'settings.yaml'), 'utf8'))) throw new Error('selftest-theme-no-force');
  fs.writeFileSync(path.join(homeT, 'settings.yaml'), 'locale:\n  preference: zh\nui-theme:\n  preference: light\n');
  pinUserSettings(homeT, persT);
  if (readTrim(path.join(persT, '.dsh-desk', 'ui-theme')) !== 'light') throw new Error('selftest-theme-share');
  fs.writeFileSync(path.join(homeT, 'settings.yaml'), 'locale:\n  preference: zh\n');
  pinUserSettings(homeT, persT);
  if (themeFromSettings(fs.readFileSync(path.join(homeT, 'settings.yaml'), 'utf8')) !== 'light') throw new Error('selftest-theme-restore');
  fs.rmSync(boxT, { recursive: true, force: true });
  fs.rmSync(boxP, { recursive: true, force: true });
  const boxDerp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-derp-mirror-'));
  const persDerp = path.join(boxDerp, 'company', '_office');
  const homeDerp = path.join(boxDerp, 'home');
  fs.mkdirSync(path.join(persDerp, '.dsh-desk', 'sessions', 's1'), { recursive: true });
  fs.mkdirSync(path.join(persDerp, '.dsh-desk', 'storages'), { recursive: true });
  fs.mkdirSync(homeDerp, { recursive: true });
  fs.writeFileSync(path.join(persDerp, '.dsh-desk', 'sessions', 's1', 'session.jsonl'), 'stub\n');
  fs.writeFileSync(path.join(persDerp, '.dsh-desk', 'storages', 'workspace.json'), '{"ok":1}\n');
  mirrorShareToLocal(homeDerp, persDerp);
  if (fs.existsSync(path.join(homeDerp, 'sessions', 's1', 'session.jsonl'))) throw new Error('selftest-derp-copied-body');
  if (fs.readFileSync(path.join(homeDerp, 'storages', 'workspace.json'), 'utf8').indexOf('"ok"') < 0) {
    throw new Error('selftest-derp-catalog');
  }
  const bodyN = mirrorShareBodiesToLocal(homeDerp, persDerp);
  if (bodyN < 1) throw new Error('selftest-slow-body-copy');
  if (!fs.existsSync(path.join(homeDerp, 'sessions', 's1', 'session.jsonl'))) throw new Error('selftest-slow-body-missing');
  const badZ = path.join(homeDerp, 'sessions', 's1', 'session.jsonl.zstd');
  fs.writeFileSync(badZ, 'not-zstd\n');
  if (sweepBadLocalZstd(homeDerp) < 1) throw new Error('selftest-sweep-bad-zstd');
  if (fs.existsSync(badZ)) throw new Error('selftest-sweep-left-bad');
  fs.rmSync(boxDerp, { recursive: true, force: true });
  const boxDerpSkip = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-derp-skip-share-'));
  const persDerpSkip = path.join(boxDerpSkip, 'company', '_office');
  const homeDerpSkip = path.join(boxDerpSkip, 'home');
  fs.mkdirSync(path.join(homeDerpSkip, 'sessions', 'local-slug', 'session-local'), { recursive: true });
  fs.mkdirSync(path.join(persDerpSkip, '.dsh-desk', 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(homeDerpSkip, 'sessions', 'local-slug', 'session-local', 'session.jsonl'), 'keep-local\n');
  harvestThenWipe(homeDerpSkip, persDerpSkip, { wipe: false, skipShare: true });
  if (fs.existsSync(path.join(persDerpSkip, '.dsh-desk', 'sessions', 'local-slug', 'session-local', 'session.jsonl'))) {
    throw new Error('selftest-derp-harvest-share');
  }
  if (!fs.existsSync(path.join(homeDerpSkip, 'sessions', 'local-slug', 'session-local', 'session.jsonl'))) {
    throw new Error('selftest-derp-harvest-wiped');
  }
  fs.rmSync(boxDerpSkip, { recursive: true, force: true });
  if (seatNote('kicked') !== NOTE_OTHER) throw new Error('selftest-note-other');
  if (seatNote('flush') !== NOTE_OTHER) throw new Error('selftest-note-flush');
  if (seatNote('desk-down') !== NOTE_EXPIRED) throw new Error('selftest-note-expired');
  if (REQUEST_TIMEOUT_MS <= HEARTBEAT_MS) throw new Error('selftest-timeout-tight');
  process.stdout.write('DESK_LEASE_JS_SELFTEST_OK=1\n');
}

async function main() {
  const cmd = process.argv[2] || '';
  if (cmd === 'selftest') return cmdSelftest();
  if (cmd === 'wipe-local') return wipeLocalSessions(deskHome());
  if (cmd === 'remap') return remapDesk(personalPath(), orgPath());
  if (cmd === 'collapse-seats') {
    const personal = personalPath();
    const org = orgPath();
    const wsPath = path.join(roamRoot(personal), 'storages', 'workspace.json');
    const ws = readJsonFile(wsPath);
    if (!ws) throw new Error('workspace-json-missing');
    collapseSeatWorkspaces(ws, personal, org);
    ensureSeatWorkspaces(ws, personal, org);
    collapseSeatWorkspaces(ws, personal, org);
    fs.writeFileSync(wsPath, JSON.stringify(ws, null, 2) + '\n');
    process.stdout.write('WS_COLLAPSE_OK=1\n');
    return;
  }
  if (cmd === 'pin-instr-presets') return pinPresetInstrRoot(deskHome());
  if (cmd === 'pin-overlay') {
    const ov = arg('overlay') || path.join(deskHome(), 'profiles', 'web', 'overlay.yml');
    return pinOverlay(ov, personalPath());
  }
  if (cmd === 'pin-role-ui') {
    const ov = arg('overlay') || path.join(deskHome(), 'profiles', 'web', 'overlay.yml');
    return pinRoleUi(ov, loginRole());
  }
  if (cmd === 'acquire') return cmdAcquire();
  if (cmd === 'heartbeat') return cmdHeartbeat();
  if (cmd === 'release' || cmd === 'quit') return cmdRelease();
  if (cmd === 'flushed') return cmdFlushed();
  if (cmd === 'watch') return cmdWatch();
  die('usage: desk-lease.js acquire|watch|quit|heartbeat|remap|collapse-seats|pin-overlay|pin-role-ui|pin-instr-presets|wipe-local|selftest');
}

main().catch((err) => die(err && err.message ? err.message : String(err)));
