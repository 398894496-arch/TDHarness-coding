'use strict';

// Company knowledge search. Listens on loopback only; the LAN reaches it
// through the login site at /company/knowledge (Caddy strips that prefix).
//
// Every search needs the gateway token a person got at login (Authorization:
// Bearer dsh_... or X-Company-Gw-Token). The token must be live in
// gw-tokens.json and belong to an active person on the roster, so revoking a
// token or disabling a person cuts search off at once. Name headers such as
// X-Auth-Request-User are ignored: anyone can type a name into a header.
// Everyone on the roster sees the whole brain for now; who-sees-what by
// department is not decided yet.

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const BRAIN = process.env.TDH_BRAIN || path.join(ROOT, 'brain');
const PORT = Number(process.env.TDH_KNOW_PORT || 4182);
const TOKENS = process.env.TDH_GW_TOKENS || path.join(ROOT, 'runtime', 'gw-tokens.json');
const ROSTER = process.env.TDH_ROSTER || path.join(ROOT, 'runtime', 'roster.json');
const LOG = process.env.TDH_KNOW_LOG || path.join(ROOT, 'logs', 'knowledge-search.log');

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}

function tokenOf(req) {
  const h = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-company-gw-token'] || '').trim();
}

// The person behind a live token, or '' when there is none.
function loginOf(token) {
  if (!token || token.indexOf('dsh_') !== 0) return '';
  const store = readJson(TOKENS);
  const rows = store && Array.isArray(store.tokens) ? store.tokens : [];
  const hit = rows.find((r) => r && !r.revoked_at && String(r.token || '') === token);
  if (!hit || !hit.pid) return '';
  const roster = readJson(ROSTER);
  const people = roster && Array.isArray(roster.people) ? roster.people : [];
  const who = people.find((p) => p && String(p.pid || '') === String(hit.pid));
  if (!who || !who.login || (who.status || 'active') !== 'active') return '';
  return String(who.login);
}

function audit(login, route, hits) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), login, route, hits }) + '\n');
  } catch (e) { /* the search still answers */ }
}

function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(md|txt)$/i.test(ent.name)) out.push(p);
  }
}

function search(query) {
  const q = String(query || '').trim().toLowerCase();
  const files = [];
  walk(BRAIN, files);
  const hits = [];
  if (!q) return { ok: true, status: 'ok', hits: [], files: files.length };
  for (const p of files) {
    let text = '';
    try { text = fs.readFileSync(p, 'utf8'); } catch (e) { continue; }
    if (text.toLowerCase().indexOf(q) >= 0) {
      hits.push({ path: p, snippet: text.slice(0, 240) });
    }
    if (hits.length >= 20) break;
  }
  return { ok: true, status: 'ok', hits, files: files.length };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const json = (code, obj) => {
    const raw = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(raw + '\n');
  };
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  if (req.method === 'POST' && (url.pathname === '/v1/search' || url.pathname === '/v1/prior-work')) {
    const login = loginOf(tokenOf(req));
    if (!login) {
      audit('', url.pathname, -1);
      json(401, { ok: false, status: 'login-required', hits: [] });
      return;
    }
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
      json(400, { ok: false, status: 'bad-request', hits: [] });
      return;
    }
    const out = search(body.query || '');
    audit(login, url.pathname, out.hits.length);
    json(200, { ...out, login });
    return;
  }
  json(404, { status: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('LISTEN=127.0.0.1:' + PORT + '\n');
});
