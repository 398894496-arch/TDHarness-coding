'use strict';

const fs = require('fs');
const http = require('http');
const gwSearch = require('./gw-search.js');
const gwMedia = require('./gw-media.js');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const ENV_PATH = process.env.TDH_GW_ENV || (ROOT + '\\runtime\\gateway.env');
const CHANNELS_PATH = process.env.TDH_CHANNELS || (ROOT + '\\runtime\\channels.json');
// Usage ledger: one line per model call, by person. The people service reads it
// for the 同事 page. Tokens only; no prompt or answer text is kept.
const USAGE_DIR = process.env.TDH_USAGE_DIR || path.join(ROOT, 'runtime', 'usage');
const TOKENS_PATH = process.env.TDH_GW_TOKENS || path.join(ROOT, 'runtime', 'gw-tokens.json');
const ROSTER_PATH = process.env.TDH_ROSTER || path.join(ROOT, 'runtime', 'roster.json');
const PORT = Number(process.env.TDH_GW_PORT || 8450);
const KEY_PRESET = {
  openai: { id: 'gpt', label: 'OpenAI', up: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  anthropic: { id: 'opus', label: 'Anthropic', up: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY' },
  kimi: { id: 'kimi', label: 'Kimi', up: 'https://api.moonshot.cn/v1', env: 'KIMI_API_KEY' },
  glm: { id: 'glm', label: '智谱 GLM', up: 'https://open.bigmodel.cn/api/paas/v4', env: 'GLM_API_KEY' },
  deepseek: { id: 'deepseek', label: 'DeepSeek', up: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY' },
  xai: { id: 'grok-key', label: 'xAI', up: 'https://api.x.ai/v1', env: 'XAI_API_KEY' }
};

// Where a model id goes. Keys live only in gateway.env on this server; desks send every
// model to this gateway with their own per-person token and never hold a vendor key.
// First match wins. Anthropic is reached through its OpenAI-compatible endpoint, so desks
// keep speaking one dialect. A model nothing matches falls back to the old single-key route.
const VENDORS = [
  { id: 'grok', label: 'Grok', match: /^grok/i, env: 'XAI_API_KEY', base: 'https://api.x.ai/v1', baseEnv: 'XAI_BASE_URL' },
  { id: 'claude', label: 'Anthropic', match: /^(claude-|opus)/i, env: 'ANTHROPIC_API_KEY', base: 'https://api.anthropic.com/v1', baseEnv: 'ANTHROPIC_BASE_URL' },
  { id: 'gpt', label: 'OpenAI', match: /^(gpt-|o[1-9]|chatgpt|codex)/i, env: 'OPENAI_API_KEY', base: 'https://api.openai.com/v1', baseEnv: 'OPENAI_BASE_URL' },
  { id: 'kimi', label: 'Kimi', match: /^(kimi|moonshot)/i, env: 'KIMI_API_KEY', base: 'https://api.moonshot.cn/v1', baseEnv: 'KIMI_BASE_URL' },
  { id: 'glm', label: '智谱 GLM', match: /^glm/i, env: 'GLM_API_KEY', base: 'https://open.bigmodel.cn/api/paas/v4', baseEnv: 'GLM_BASE_URL' },
  { id: 'deepseek', label: 'DeepSeek', match: /^deepseek/i, env: 'DEEPSEEK_API_KEY', base: 'https://api.deepseek.com/v1', baseEnv: 'DEEPSEEK_BASE_URL' }
];

function keyOk(v) { return typeof v === 'string' && v.trim().length >= 8; }

/** Route for one request: { vendor, label, base (OpenAI-style, ends at the version), key, grok } or { missing }. */
async function routeFor(model, url, env) {
  const xaiFiles = /^\/v1\/(files|language-models)(\/|$)/.test(url);
  if (model.indexOf('grok') === 0 || xaiFiles) {
    const x = await loadXai();
    if (x) return { vendor: 'xai', label: 'Grok', base: XAI_BASE + '/v1', key: x.access_token, grok: true };
  }
  for (const row of loadChannels()) {
    if (!row || !row.custom || !row.env || !Array.isArray(row.models) || row.models.indexOf(model) < 0) continue;
    if (keyOk(env[row.env]) && row.up) return { vendor: row.id, label: String(row.label || row.id), base: String(row.up).replace(/\/$/, ''), key: env[row.env].trim(), grok: false };
  }
  for (const v of VENDORS) {
    if (!v.match.test(model)) continue;
    if (keyOk(env[v.env])) return { vendor: v.id, label: v.label, base: String(env[v.baseEnv] || v.base).replace(/\/$/, ''), key: env[v.env].trim(), grok: v.id === 'grok' };
    return { missing: v.label, model: model };
  }
  const key = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '';
  if (!keyOk(key)) return { missing: '', model: model };
  return { vendor: 'other', label: 'default', base: String(env.DEEPSEEK_BASE_URL || env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, ''), key: key.trim(), grok: false };
}

function loadEnv(p) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(p, 'utf8'); } catch (e) { return out; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const OAUTH_PATH = process.env.TDH_XAI_OAUTH || (ROOT + '\\runtime\\oauth\\xai-account.json');

const XAI_TOKEN_URL = process.env.TDH_XAI_TOKEN_URL || 'https://auth.x.ai/oauth2/token';
const XAI_BASE = (process.env.TDH_XAI_BASE || 'https://api.x.ai').replace(/\/$/, '');
// Renew this long before expiry so a chat that starts now does not die mid-stream.
const XAI_PREEMPT_MS = 5 * 60 * 1000;
let xaiRenewing = null;

function readXai() {
  try {
    const j = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    if (!j || typeof j.access_token !== 'string' || j.access_token.length < 20) return null;
    return j;
  } catch (e) {
    return null;
  }
}

function xaiFresh(j, slackMs) {
  const exp = Date.parse(j.expired || '');
  return !exp || exp - Date.now() > slackMs;
}

function xaiCanRenew(j) {
  return typeof j.refresh_token === 'string' && j.refresh_token.length >= 8 && !!xaiClientId(j);
}

// The login file names its own OAuth client in the id_token audience, so no
// client id is written into this repo.
function xaiClientId(j) {
  try {
    const part = String(j.id_token || '').split('.')[1] || '';
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    return typeof aud === 'string' ? aud : '';
  } catch (e) {
    return '';
  }
}

function xaiBound() {
  const j = readXai();
  return !!(j && (xaiFresh(j, 0) || xaiCanRenew(j)));
}

function postForm(url, form) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const raw = Buffer.from(new URLSearchParams(form).toString(), 'utf8');
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': raw.length },
      timeout: 20000
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let obj = null;
        try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { obj = null; }
        resolve({ status: r.statusCode || 502, obj: obj });
      });
    });
    req.on('error', () => resolve({ status: 0, obj: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, obj: null }); });
    req.end(raw);
  });
}

async function renewXai(j) {
  const up = await postForm(XAI_TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: xaiClientId(j),
    refresh_token: j.refresh_token
  });
  const t = up.obj;
  if (up.status !== 200 || !t || typeof t.access_token !== 'string' || t.access_token.length < 20) return null;
  // The refresh token rotates. Write the new one before anything can fail, or
  // the next renewal presents a token the vendor has already retired.
  const now = Date.now();
  const next = Object.assign({}, j, { access_token: t.access_token });
  if (typeof t.refresh_token === 'string' && t.refresh_token) next.refresh_token = t.refresh_token;
  if (typeof t.id_token === 'string' && t.id_token) next.id_token = t.id_token;
  const ttl = typeof t.expires_in === 'number' && t.expires_in > 0 ? t.expires_in : 3600;
  next.expires_in = ttl;
  next.expired = new Date(now + ttl * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  next.last_refresh = new Date(now).toISOString().replace(/\.\d+Z$/, 'Z');
  const tmp = OAUTH_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, OAUTH_PATH);
  return next;
}

// A usable login, renewed first when it is about to lapse. null means the
// caller must not send a Grok request.
async function loadXai() {
  const j = readXai();
  if (!j) return null;
  if (xaiFresh(j, XAI_PREEMPT_MS)) return j;
  if (!xaiCanRenew(j)) return xaiFresh(j, 0) ? j : null;
  if (!xaiRenewing) {
    xaiRenewing = renewXai(j).then(
      (v) => { xaiRenewing = null; return v; },
      () => { xaiRenewing = null; return null; }
    );
  }
  const renewed = await xaiRenewing;
  if (renewed) return renewed;
  return xaiFresh(j, 0) ? j : null;
}

// Grok 订阅额度：和 EasyCLI 管理面板同一个接口（cli-chat-proxy.grok.com/v1/billing?format=credits），
// 用服务器自己绑定的 OAuth 令牌查。结果缓存 60 秒，避免桌面端轮询打满上游。
const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits';
let grokQuotaCache = { at: 0, val: null };

async function grokQuota() {
  if (grokQuotaCache.val && Date.now() - grokQuotaCache.at < 60 * 1000) return grokQuotaCache.val;
  const x = await loadXai();
  if (!x) return null;
  const headers = {
    Authorization: 'Bearer ' + x.access_token,
    'x-xai-token-auth': 'xai-grok-cli',
    'x-grok-client-version': '0.2.91',
    accept: '*/*',
    'user-agent': 'grok-pager/0.2.91 grok-shell/0.2.91 (windows; x86_64)'
  };
  if (typeof x.sub === 'string' && x.sub) headers['x-userid'] = x.sub;
  const r = await fetch(GROK_BILLING_URL, { headers, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('grok-billing-http-' + r.status);
  const o = await r.json();
  const c = (o && o.config) || o || {};
  const period = c.currentPeriod || c.current_period || null;
  const raw = c.creditUsagePercent != null ? c.creditUsagePercent : c.credit_usage_percent;
  // 上游按 protobuf JSON 省略 0 值：有本周周期但没给百分比 = 本周还没用。
  let used = raw != null && isFinite(Number(raw)) ? Number(raw) : (period ? 0 : null);
  if (used != null) used = Math.max(0, Math.min(100, used));
  const val = {
    usedPercent: used,
    remainingPercent: used == null ? null : 100 - used,
    resetsAt: (period && period.end) || c.billingPeriodEnd || '',
    plan: period && /WEEKLY/i.test(String(period.type || '')) ? '每周额度' : ''
  };
  grokQuotaCache = { at: Date.now(), val };
  return val;
}

function modelName(body) {
  if (!body || !body.length) return '';
  try {
    const j = JSON.parse(body.toString('utf8'));
    return typeof j.model === 'string' ? j.model : '';
  } catch (e) {
    return '';
  }
}

function listUpstream(url, token, extra) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname,
      method: 'GET',
      headers: Object.assign({ authorization: 'Bearer ' + token }, extra || {}),
      timeout: 20000
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let rows = [];
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          rows = Array.isArray(j.data) ? j.data : [];
        } catch (e) { rows = []; }
        resolve({ status: r.statusCode || 502, rows: rows });
      });
    });
    req.on('error', () => resolve({ status: 0, rows: [] }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, rows: [] }); });
    req.end();
  });
}

// "Fast" is xAI's priority service tier, a per-request field every chat model
// accepts. It is not the "none" reasoning level: that one stays in `efforts`
// and is offered as a level like the others.
const FAST_PATH = process.env.TDH_GROK_FAST || (ROOT + '\\runtime\\grok-fast.json');
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function readFastFile() {
  try {
    const j = JSON.parse(fs.readFileSync(FAST_PATH, 'utf8'));
    return {
      models: Array.isArray(j.models) ? j.models.filter((x) => typeof x === 'string') : [],
      probed: j.probed && typeof j.probed === 'object' && !Array.isArray(j.probed) ? j.probed : {}
    };
  } catch (e) {
    return { models: [], probed: {} };
  }
}

function writeFastFile(state) {
  fs.mkdirSync(path.dirname(FAST_PATH), { recursive: true });
  const tmp = FAST_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, FAST_PATH);
}

// Models a person marked fast, limited to the ones the vendor was seen to
// serve on the priority tier.
function loadFast() {
  const state = readFastFile();
  return new Set(state.models.filter((id) => state.probed[id] && state.probed[id].fast === true));
}

function saveFast(ids) {
  const state = readFastFile();
  state.models = ids;
  writeFastFile(state);
}

function postJson(url, token, obj, timeoutMs) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'http:' ? http : https;
    const raw = Buffer.from(JSON.stringify(obj), 'utf8');
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': raw.length, authorization: 'Bearer ' + token },
      agent: u.protocol === 'http:' ? keepHttp : keepHttps,
      timeout: timeoutMs || 45000
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { j = null; }
        resolve({ status: r.statusCode || 502, obj: j });
      });
    });
    req.on('error', () => resolve({ status: 0, obj: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, obj: null }); });
    req.end(raw);
  });
}

// What this login can really do with one model, learned by asking once.
//   usable: a plain chat request is answered
//   fast:   a request for the priority tier is answered ON the priority tier
//   image:  a message carrying a picture is answered
// The listing does not say either, and some listed models refuse chat outright.
// A failure that says nothing about the model (network, 5xx, 401, 429) is not
// recorded, so it is asked again next time.
// A 64x64 picture. The vendor refuses small ones (under 8x8, then under 512
// pixels in all) as an invalid image, which reads exactly like "this model
// takes no pictures" and is not.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PQQkAAAgEsItjJhMbywi+hcEKLNXzWgQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQELgtZCaEttSk+KwAAAABJRU5ErkJggg==';
// Bump when what a probe asks changes, so earlier answers are asked again.
const PROBE_REV = 3;

// A reply that is neither a clear yes (200) nor a clear refusal of this model.
function undecided(status) {
  return status !== 200 && (status < 400 || status >= 500 || status === 401 || status === 429);
}

async function probeModel(id, token) {
  const ask = { model: id, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };
  const url = XAI_BASE + '/v1/chat/completions';
  let fast = false;
  const tiered = await postJson(url, token, Object.assign({ service_tier: 'priority' }, ask));
  if (tiered.status === 200) {
    fast = !!(tiered.obj && tiered.obj.service_tier === 'priority');
  } else {
    if (undecided(tiered.status)) return null;
    const plain = await postJson(url, token, ask);
    if (undecided(plain.status)) return null;
    if (plain.status !== 200) return { rev: PROBE_REV, usable: false, fast: false, image: false };
  }
  const seen = await postJson(url, token, {
    model: id,
    max_tokens: 1,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: PIXEL } }] }]
  });
  if (undecided(seen.status)) return null;
  // A complaint about the picture itself says nothing about the model.
  if (seen.status !== 200 && seen.obj && seen.obj.code === 'invalid_image') return null;
  return { rev: PROBE_REV, usable: true, fast: fast, image: seen.status === 200 };
}

let probing = null;

async function probeMissing(ids, token) {
  const state = readFastFile();
  const todo = ids.filter((id) => !state.probed[id] || state.probed[id].rev !== PROBE_REV);
  if (!todo.length) return state.probed;
  if (!probing) {
    probing = Promise.all(todo.map((id) => probeModel(id, token).then((got) => [id, got]))).then((rows) => {
      const fresh = readFastFile();
      for (const [id, got] of rows) if (got) fresh.probed[id] = got;
      writeFastFile(fresh);
      probing = null;
      return fresh.probed;
    }, () => { probing = null; return readFastFile().probed; });
  }
  return probing;
}

// Ask for the priority tier when this model is marked fast and the caller did
// not choose a tier itself.
function withFastTier(body) {
  if (!body || !body.length) return body;
  let j = null;
  try { j = JSON.parse(body.toString('utf8')); } catch (e) { return body; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return body;
  if (typeof j.model !== 'string' || Object.prototype.hasOwnProperty.call(j, 'service_tier')) return body;
  if (!loadFast().has(j.model)) return body;
  j.service_tier = 'priority';
  return Buffer.from(JSON.stringify(j), 'utf8');
}

// Context windows as the vendor itself stated them when it refused an
// oversized prompt ("... > 500000 tokens"), measured 2026-10-04. Its model
// listing does not carry this number. grok-4.3 accepted an 858k-token prompt,
// so its entry is a floor, not the limit. A model not listed here gets no
// `context` and the desk falls back to its own conservative default.
const CONTEXT_MEASURED = {
  'grok-4.7': 500000,
  'grok-4.6': 500000,
  'grok-4.3': 850000
};

function catalogFromUpstream(rows, probed) {
  const fast = loadFast();
  const out = [];
  for (const row of rows) {
    const id = row && typeof row.id === 'string' ? row.id : '';
    if (!id || !MODEL_ID.test(id) || /imagine|image|video/i.test(id)) continue;
    const seen = probed && probed[id] ? probed[id] : null;
    if (seen && seen.usable === false) continue;
    const cap = row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {};
    const efforts = Array.isArray(cap.reasoning_effort) ? cap.reasoning_effort.filter((x) => typeof x === 'string' && x) : [];
    const row1 = { id: id, efforts: efforts, fast: !!(seen && seen.fast), fastOn: fast.has(id), image: !!(seen && seen.image) };
    if (CONTEXT_MEASURED[id]) row1.context = CONTEXT_MEASURED[id];
    out.push(row1);
  }
  return out;
}

function send(res, code, obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': raw.length });
  res.end(raw);
}

// One warm connection per vendor instead of a new TLS handshake for every
// message; through a proxied line the handshake alone is a visible pause.
const keepHttps = new https.Agent({ keepAlive: true, maxSockets: 16 });
const keepHttp = new http.Agent({ keepAlive: true, maxSockets: 16 });

// Who is calling: the desk sends its person's gateway token (dsh_...), the same
// one the knowledge search checks. A token counts only while it is live in
// gw-tokens.json and its person is active on the roster. Both files are read
// again whenever either changes on disk, so a revoke or a 停用 cuts the next
// request, and a token minted after start is known at once.
let whoCache = { stamp: '', map: {} };
function readJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}
function fileStamp(p) {
  try { const s = fs.statSync(p); return s.mtimeMs + ':' + s.size; } catch (e) { return '-'; }
}
function tokenOf(req) {
  const h = String(req.headers.authorization || '').trim();
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, '').trim();
  return String(req.headers['x-company-gw-token'] || '').trim();
}
function personOf(req) {
  const tok = tokenOf(req);
  if (!/^dsh_/.test(tok)) return null;
  const stamp = fileStamp(TOKENS_PATH) + '|' + fileStamp(ROSTER_PATH);
  if (stamp !== whoCache.stamp) {
    const tokens = (readJsonFile(TOKENS_PATH) || {}).tokens || [];
    const people = (readJsonFile(ROSTER_PATH) || {}).people || [];
    const byPid = {};
    for (const p of people) {
      if (p && p.pid && p.login && (p.status || 'active') === 'active') byPid[p.pid] = { login: String(p.login), role: String(p.role || '') };
    }
    const map = {};
    for (const t of tokens) if (t && t.token && !t.revoked_at && byPid[t.pid]) map[t.token] = byPid[t.pid];
    whoCache = { stamp, map };
  }
  return whoCache.map[tok] || null;
}
function callerOf(req) {
  const who = personOf(req);
  return who ? who.login : '';
}

// The gateway listens on the LAN (desks reach it directly, not through Caddy),
// so it checks every request that spends a key or changes a setting:
//   - model calls, files, /search, /fetch, /images, /videos: a live token;
//   - POST /channels (keys and channel settings): a live token of an admin;
//   - /health, GET /channels, /v1/company-models, /grok-quota, /grok-fast:
//     open. They say which channels are bound and which models exist, never a key.
// This machine itself is trusted: the nightly brain job and the setup proofs
// call 127.0.0.1. Nothing on this machine forwards LAN traffic to 8450.
// GW_ALLOW_TOKENLESS=1 in gateway.env lets a request with no token at all
// through the first group, for desks not yet updated to send one on every
// door. A wrong or revoked token is refused either way. Read per request.
const TRUST_LOOPBACK = process.env.TDH_GW_TRUST_LOOPBACK !== '0';
function fromThisMachine(req) {
  const a = String((req.socket && req.socket.remoteAddress) || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
const DENY = {
  login: '没有有效的登录令牌。请退出客户端重新登录；客户端提示有更新时先更新。',
  admin: '只有管理员能改模型和钥匙设置。'
};
function gate(req, url, env) {
  if (TRUST_LOOPBACK && fromThisMachine(req)) return null;
  const method = String(req.method || 'GET').toUpperCase();
  if (url === '/health') return null;
  if (url === '/channels' || url === '/channels/') {
    if (method !== 'POST') return null;
    const who = personOf(req);
    if (!who) return { status: 401, obj: { ok: false, error: 'login', hint: DENY.login } };
    if (who.role !== 'admin') return { status: 403, obj: { ok: false, error: 'admin-only', hint: DENY.admin } };
    return null;
  }
  if (url === '/v1/company-models' || url === '/company-models' || url === '/grok-quota' || url === '/grok-fast') return null;
  if (personOf(req)) return null;
  if (!tokenOf(req) && String(env.GW_ALLOW_TOKENLESS || '').trim() === '1') return null;
  return { status: 401, obj: { error: { message: DENY.login, type: 'gateway_unauthorized' } } };
}

// Read the token counts out of a vendor answer as it passes. Chat completions
// put them in a final "usage" object (streamed or not); the Responses API puts
// them in response.usage on its last event. The last one seen wins.
function usageTap() {
  let tail = '';
  let whole = '';
  let found = null;
  const take = (obj) => {
    const u = obj && (obj.usage || (obj.response && obj.response.usage));
    if (!u || typeof u !== 'object') return;
    const input = Number(u.prompt_tokens != null ? u.prompt_tokens : u.input_tokens) || 0;
    const output = Number(u.completion_tokens != null ? u.completion_tokens : u.output_tokens) || 0;
    const cached = Number((u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || (u.input_tokens_details && u.input_tokens_details.cached_tokens) || 0);
    const reasoning = Number((u.completion_tokens_details && u.completion_tokens_details.reasoning_tokens) || (u.output_tokens_details && u.output_tokens_details.reasoning_tokens) || 0);
    if (input || output) found = { input, output, cached, reasoning };
  };
  return {
    feed(chunk) {
      const text = chunk.toString('utf8');
      if (whole.length < 4 * 1024 * 1024) whole += text;
      tail += text;
      let i;
      while ((i = tail.indexOf('\n')) >= 0) {
        const line = tail.slice(0, i).trim();
        tail = tail.slice(i + 1);
        if (line.startsWith('data:') && line.indexOf('usage') >= 0) {
          try { take(JSON.parse(line.slice(5).trim())); } catch (e) { /* not json */ }
        }
      }
    },
    end() {
      if (!found && whole && whole.trim().charAt(0) === '{') {
        try { take(JSON.parse(whole)); } catch (e) { /* not json */ }
      }
      return found;
    }
  };
}

function recordUsage(row) {
  try {
    fs.mkdirSync(USAGE_DIR, { recursive: true });
    const d = new Date(row.t);
    const name = 'usage-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '.jsonl';
    fs.appendFileSync(path.join(USAGE_DIR, name), JSON.stringify(row) + '\n');
  } catch (e) { /* a ledger write must never break a model call */ }
}

// Pass the vendor's answer through as it arrives. Holding it until it was
// complete meant a streamed reply reached the desk in one piece at the very
// end: the person watched an empty screen for the whole generation.
// What desks may pick: every model this server can reach, plus the site default. Desks fetch
// this at login (company-shell) and list exactly these, so the picker never offers a model the
// gateway would refuse. Cached; a key added or removed in Settings clears the cache.
let companyModelsCache = { at: 0, val: null };
const NOT_CHAT = /(embed|tts|whisper|dall-e|davinci|babbage|audio|realtime|moderation|transcribe|search|computer-use|instruct|image|imagine|video)/i;
const VISION = /^(grok-|claude-|gpt-4o|gpt-4\.1|gpt-5|o3|o4|glm-4v|kimi-.*vision)/i;

async function companyModels(env) {
  if (companyModelsCache.val && Date.now() - companyModelsCache.at < 10 * 60 * 1000) return companyModelsCache.val;
  const out = [];
  const seen = new Set();
  const add = (rows, vendor) => {
    for (const r of rows) {
      if (!r || !r.id || seen.has(r.id) || !MODEL_ID.test(r.id) || NOT_CHAT.test(r.id)) continue;
      seen.add(r.id);
      out.push(Object.assign({ vendor: vendor, efforts: [], image: VISION.test(r.id) }, r));
    }
  };
  const xai = await loadXai();
  if (xai) {
    const up = await listUpstream(XAI_BASE + '/v1/models', xai.access_token);
    if (up.status === 200) {
      const ids = up.rows.map((r) => (r && typeof r.id === 'string' ? r.id : '')).filter((id) => MODEL_ID.test(id) && !NOT_CHAT.test(id));
      add(catalogFromUpstream(up.rows, await probeMissing(ids, xai.access_token)), 'grok');
    }
  }
  for (const v of VENDORS) {
    if (!keyOk(env[v.env]) || (v.id === 'grok' && xai)) continue;
    const base = String(env[v.baseEnv] || v.base).replace(/\/$/, '');
    const extra = v.id === 'claude' ? { 'x-api-key': env[v.env].trim(), 'anthropic-version': '2023-06-01' } : null;
    const up = await listUpstream(base + '/models', env[v.env].trim(), extra);
    if (up.status === 200) add(up.rows.map((r) => ({ id: r && r.id })), v.id);
  }
  for (const row of loadChannels()) {
    if (row && row.custom && row.env && keyOk(env[row.env]) && Array.isArray(row.models)) add(row.models.map((id) => ({ id: id })), row.id);
  }
  // Site default: DEFAULT_MODEL / DEFAULT_EFFORT in gateway.env when set and reachable; else the
  // first model of the first vendor that has one (subscription first, then keys in table order).
  let pick = out.find((m) => m.id === String(env.DEFAULT_MODEL || '').trim()) || null;
  if (!pick) {
    for (const vid of ['grok', 'gpt', 'claude', 'deepseek', 'kimi', 'glm']) {
      pick = out.find((m) => m.vendor === vid);
      if (pick) break;
    }
  }
  if (!pick) pick = out[0] || null;
  const want = String(env.DEFAULT_EFFORT || 'high').trim();
  const val = {
    ok: true,
    models: out,
    default: pick ? { model: pick.id, effort: pick.efforts.indexOf(want) >= 0 ? want : (pick.efforts.indexOf('high') >= 0 ? 'high' : '') } : null
  };
  companyModelsCache = { at: Date.now(), val: val };
  return val;
}

function relay(route, req, body, res) {
  const key = route && route.key;
  if (!key) return Promise.reject(new Error('no-key'));
  const base = route.base.endsWith('/') ? route.base : route.base + '/';
  const u = new URL((req.url || '/v1/models').replace(/^\/v1\/?/, '') || 'models', base);
  const plain = u.protocol === 'http:';
  const headers = {
    'content-type': req.headers['content-type'] || 'application/json',
    authorization: 'Bearer ' + key
  };
  if (req.headers.accept) headers.accept = req.headers.accept;
  if (body && body.length) headers['content-length'] = body.length;
  return new Promise((resolve, reject) => {
    const up = (plain ? http : https).request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (plain ? 80 : 443),
      path: u.pathname + u.search,
      method: req.method,
      headers,
      agent: plain ? keepHttp : keepHttps,
      // Idle time, not total time: a large upload or a long answer keeps the
      // socket busy and is fine. Without it a stalled vendor connection held
      // the caller for good.
      timeout: 180000
    }, (r) => {
      const out = { 'content-type': r.headers['content-type'] || 'application/json', 'cache-control': 'no-store' };
      // Tell anything between here and the desk not to collect the stream.
      if (/text\/event-stream/i.test(String(r.headers['content-type'] || ''))) out['x-accel-buffering'] = 'no';
      res.writeHead(r.statusCode || 502, out);
      if (typeof res.flushHeaders === 'function') res.flushHeaders();
      const tap = (r.statusCode || 0) < 300 && /\/(chat\/completions|responses|messages)$/.test(u.pathname) ? usageTap() : null;
      const settle = () => {
        if (!tap) return;
        const used = tap.end();
        if (used) recordUsage(Object.assign({ t: Date.now(), login: callerOf(req) || 'unknown', model: modelName(body) || 'unknown', vendor: route.vendor }, used));
      };
      r.on('data', (c) => { res.write(c); if (tap) tap.feed(c); });
      r.on('end', () => { res.end(); settle(); resolve(); });
      r.on('error', () => { res.end(); settle(); resolve(); });
    });
    up.on('timeout', () => up.destroy(new Error('upstream-idle')));
    up.on('error', reject);
    // The desk gave up (closed the tab, pressed stop): stop paying for the rest.
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    if (body && body.length) up.write(body);
    up.end();
  });
}

function loadChannels() {
  try {
    const data = JSON.parse(fs.readFileSync(CHANNELS_PATH, 'utf8'));
    return Array.isArray(data.channels) ? data.channels : [];
  } catch (e) {
    return [];
  }
}

function saveChannels(rows) {
  fs.mkdirSync(path.dirname(CHANNELS_PATH), { recursive: true });
  fs.writeFileSync(CHANNELS_PATH, JSON.stringify({ channels: rows }, null, 2) + '\n');
}

function writeEnvLine(name, value) {
  let raw = '';
  try { raw = fs.readFileSync(ENV_PATH, 'utf8'); } catch (e) { raw = ''; }
  const re = new RegExp('^' + name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '=.*$', 'm');
  if (re.test(raw)) raw = raw.replace(re, name + '=' + value);
  else {
    if (raw && !/\n$/.test(raw)) raw += '\n';
    raw += name + '=' + value + '\n';
  }
  fs.writeFileSync(ENV_PATH, raw);
}

function boundEnv(env, name) {
  return String(env[name] || '').trim().length >= 8;
}

function subOf(id, label, extras, hint) {
  const hit = extras.find((r) => r && (r.id === id || (id === 'gpt' && r.id === 'chatgpt')));
  return {
    id: id,
    kind: 'subscription',
    label: label,
    bound: !!(hit && (hit.accessToken || hit.refreshToken)),
    model: hit && hit.model ? String(hit.model) : '',
    hint: hint
  };
}

function channelSnapshot(env) {
  const models = [
    { id: 'deepseek', kind: 'key', label: 'DeepSeek', bound: boundEnv(env, 'DEEPSEEK_API_KEY'), up: 'https://api.deepseek.com' },
    { id: 'gpt', kind: 'key', label: 'OpenAI', bound: boundEnv(env, 'OPENAI_API_KEY'), up: 'https://api.openai.com' },
    { id: 'opus', kind: 'key', label: 'Anthropic', bound: boundEnv(env, 'ANTHROPIC_API_KEY'), up: 'https://api.anthropic.com' }
  ];
  const extras = loadChannels();
  const seen = new Set(models.map((m) => m.id));
  for (const row of extras) {
    if (!row || !row.id || seen.has(row.id)) continue;
    if (row.kind === 'subscription' || row.id === 'grok' || row.id === 'gpt' || row.id === 'chatgpt' || row.id === 'claude') continue;
    seen.add(row.id);
    models.push({
      id: row.id,
      kind: row.kind || 'key',
      label: String(row.label || row.id),
      bound: !!row.bound,
      up: String(row.up || ''),
      models: Array.isArray(row.models) ? row.models : []
    });
  }
  return {
    ok: true,
    mark: 'company-channels-v1',
    subscriptions: [
      subOf('grok', 'Grok', extras, ''),
      subOf('gpt', 'GPT', extras, 'sub-use-key'),
      subOf('claude', 'Claude', extras, 'sub-use-key')
    ].map((row) => row.id === 'grok' ? Object.assign({}, row, { bound: xaiBound() }) : row),
    models
  };
}

async function handleChannels(req, body, env) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return { status: 200, obj: channelSnapshot(env) };
  if (method !== 'POST') return { status: 405, obj: { ok: false, error: 'method' } };
  let payload = {};
  try { payload = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { payload = {}; }
  const action = String(payload.action || '');
  if (action === 'add-sub') {
    const vendor = String(payload.vendor || '').toLowerCase();
    if (vendor === 'gpt' || vendor === 'chatgpt' || vendor === 'claude') {
      return { status: 400, obj: { ok: false, error: 'sub-use-key', hint: '账号订阅还没接通。先用选择模型，或到下面的 API key 通道。' } };
    }
    if (vendor !== 'grok') return { status: 400, obj: { ok: false, error: 'sub-vendor' } };
    return { status: 400, obj: { ok: false, error: 'login-not-installed', hint: '这台没有订阅登录插件，不能跳转登录。' } };
  }
  if (action === 'pick-model') {
    const vendor = String(payload.vendor || '').toLowerCase();
    const model = String(payload.model || '').trim();
    if (vendor !== 'grok' && vendor !== 'gpt' && vendor !== 'claude') {
      return { status: 400, obj: { ok: false, error: 'sub-vendor' } };
    }
    if (!model) return { status: 400, obj: { ok: false, error: 'model' } };
    const rows = loadChannels().filter((r) => r && r.id !== vendor);
    const prev = loadChannels().find((r) => r && r.id === vendor) || {};
    rows.push({
      id: vendor,
      kind: 'subscription',
      label: vendor === 'grok' ? 'Grok' : (vendor === 'gpt' ? 'GPT' : 'Claude'),
      bound: prev.bound === true,
      model: model,
      vendor: vendor
    });
    saveChannels(rows);
    return { status: 200, obj: channelSnapshot(loadEnv(ENV_PATH)) };
  }
  if (action === 'add-key') {
    const presetName = String(payload.preset || '').toLowerCase();
    const preset = KEY_PRESET[presetName] || null;
    const id = String((preset && preset.id) || payload.id || '').toLowerCase();
    const key = String(payload.key || '').trim();
    if (!id || key.length < 8) return { status: 400, obj: { ok: false, error: 'key' } };
    // A custom OpenAI-compatible endpoint gets its own key name; it used to overwrite DEEPSEEK_API_KEY.
    const custom = !preset && id !== 'deepseek';
    const envName = preset && preset.env ? preset.env : (custom ? 'KEY_' + id.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : 'DEEPSEEK_API_KEY');
    writeEnvLine(envName, key);
    const rows = loadChannels().filter((r) => r && r.id !== id);
    rows.push({
      id,
      kind: 'key',
      label: String((preset && preset.label) || payload.id || id),
      bound: true,
      up: String((preset && preset.up) || payload.up || ''),
      models: String(payload.models || '').split(/[,\s]+/).filter(Boolean),
      env: envName,
      custom: custom
    });
    companyModelsCache = { at: 0, val: null };
    saveChannels(rows);
    return { status: 200, obj: channelSnapshot(loadEnv(ENV_PATH)) };
  }
  if (action === 'drop-key') {
    const id = String(payload.id || '').toLowerCase();
    if (!id || id === 'gpt' || id === 'opus' || id === 'deepseek') {
      return { status: 400, obj: { ok: false, error: 'builtin' } };
    }
    saveChannels(loadChannels().filter((r) => r && r.id !== id));
    return { status: 200, obj: channelSnapshot(loadEnv(ENV_PATH)) };
  }
  if (action === 'list-models') {
    const vendor = String(payload.vendor || '').toLowerCase();
    if (vendor !== 'grok') return { status: 400, obj: { ok: false, error: 'sub-vendor' } };
    const xai = await loadXai();
    if (!xai) return { status: 400, obj: { ok: false, error: 'login-not-installed', models: [] } };
    const up = await listUpstream(XAI_BASE + '/v1/models', xai.access_token);
    if (up.status !== 200) return { status: 502, obj: { ok: false, error: 'upstream-' + up.status, models: [] } };
    const ids = up.rows.map((r) => (r && typeof r.id === 'string' ? r.id : '')).filter((id) => MODEL_ID.test(id) && !/imagine|image|video/i.test(id));
    const probed = await probeMissing(ids, xai.access_token);
    return { status: 200, obj: { ok: true, vendor: 'grok', models: catalogFromUpstream(up.rows, probed) } };
  }
  if (action === 'recognize-key') {
    const key = String(payload.key || '').trim();
    const base = String(payload.baseURL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
    if (key.length < 8) return { status: 400, obj: { ok: false, error: 'key', models: [] } };
    const root = base.endsWith('/models') ? base : (base.endsWith('/v1') ? base + '/models' : base + '/v1/models');
    const up = await listUpstream(root, key);
    if (up.status !== 200) return { status: 502, obj: { ok: false, error: 'upstream-' + up.status, models: [] } };
    return { status: 200, obj: { ok: true, vendor: 'api', models: catalogFromUpstream(up.rows) } };
  }
  if (action === 'set-fast') {
    const vendor = String(payload.vendor || '').toLowerCase();
    if (vendor !== 'grok') return { status: 400, obj: { ok: false, error: 'sub-vendor' } };
    const ids = [];
    for (const id of Array.isArray(payload.models) ? payload.models : []) {
      if (typeof id === 'string' && MODEL_ID.test(id) && ids.indexOf(id) < 0) ids.push(id);
    }
    saveFast(ids);
    return { status: 200, obj: { ok: true, vendor: 'grok', models: ids } };
  }
  if (action === 'apply-models') {
    // The model list lives in each desk's own profile and the desk writes it.
    // This side used to edit desk files on the server and reached only the
    // install template.
    return { status: 400, obj: { ok: false, error: 'desk-side', hint: '这台桌面的界面壳版本太旧，请更新客户端。' } };
  }
  return { status: 400, obj: { ok: false, error: 'action' } };
}

const server = http.createServer(async (req, res) => {
  const env = loadEnv(ENV_PATH);
  const url = String(req.url || '').split('?')[0];
  const deny = gate(req, url, env);
  if (deny) {
    // Drain the body so the desk gets the answer instead of a reset socket.
    req.resume();
    try { console.log('GW_DENY ' + deny.status + ' ' + String(req.method) + ' ' + url + ' from ' + String((req.socket && req.socket.remoteAddress) || '')); } catch (e) { /* log only */ }
    send(res, deny.status, deny.obj);
    return;
  }
  if (req.method === 'GET' && url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  if (url === '/channels' || url === '/channels/') {
    const body = (req.method === 'POST') ? await readBody(req) : Buffer.alloc(0);
    const out = await handleChannels(req, body, env);
    send(res, out.status, out.obj);
    return;
  }
  if (req.method === 'GET' && (url === '/v1/company-models' || url === '/company-models')) {
    try { send(res, 200, await companyModels(env)); } catch (e) { send(res, 502, { ok: false, error: String((e && e.message) || e) }); }
    return;
  }
  if (url === '/grok-quota' && xaiBound()) {
    let q = null;
    let err = '';
    try { q = await grokQuota(); } catch (e) { err = String((e && e.message) || e); }
    send(res, 200, Object.assign({ ok: true, enabled: !!q, grokBound: true, kind: 'oauth', usedPercent: null, remainingPercent: null, plan: '', resetsAt: '' }, q || {}, err ? { quotaError: err } : {}));
    return;
  }
  if (url === '/grok-quota' || url === '/grok-fast') {
    send(res, 200, { ok: true, enabled: false, grokBound: xaiBound(), usedPercent: null, remainingPercent: null, plan: '', kind: xaiBound() ? 'oauth' : 'key' });
    return;
  }
  const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : Buffer.alloc(0);
  // The desk's web_search and web_fetch tools come here (company-web-search),
  // and are answered by the search route (gw-search.js). It needs no model key.
  if (req.method === 'POST' && (url === '/search' || url === '/fetch')) {
    const ctx = {
      upFetch: (u, init) => fetch(u, init),
      port: PORT,
      caller: callerOf(req) || 'desk',
      note: (line) => { try { console.log(line); } catch (e) { /* log only */ } },
      hasGrok: () => xaiBound(),
      grokUp: () => XAI_BASE,
      grokBearer: async () => { const x = await loadXai(); if (!x) throw new Error('grok-not-bound'); return x.access_token; }
    };
    if (url === '/search') await gwSearch.handleSearch(res, body, ctx);
    else await gwSearch.handleFetch(res, body, ctx);
    return;
  }
  // 生图/生视频门：员工端 company-grok-media 插件 POST 到这里，用服务器绑定的同一个 Grok 订阅。
  if (req.method === 'POST' && (url === '/images' || url === '/videos')) {
    const ctx = {
      upFetch: (u, init) => fetch(u, init),
      note: (line) => { try { console.log(line); } catch (e) { /* log only */ } },
      caller: callerOf(req) || 'desk',
      grokBearer: async () => { const x = await loadXai(); if (!x) throw new Error('grok-not-bound'); return x.access_token; },
      grokUp: () => XAI_BASE
    };
    try {
      if (url === '/videos') await gwMedia.handleVideos(res, body, ctx);
      else await gwMedia.handleImages(res, body, ctx);
    } catch (e) {
      if (!res.headersSent) send(res, 502, { error: { message: String((e && e.message) || e), type: 'media_failed' } });
      else res.end();
    }
    return;
  }
  const model = modelName(body);
  // The vendor's file store has no model in the request (an upload is
  // multipart, a lookup has no body), so it is recognised by its path. A video
  // too large to send inline is uploaded there and then named in the question.
  const route = await routeFor(model, url, env);
  if (!route || route.missing !== undefined) {
    const who = route && route.missing ? route.missing + ' ' : '';
    send(res, 503, {
      error: {
        message: 'This server has no ' + who + 'key or subscription for "' + (model || '?') + '". An admin adds it in Settings > 模型; it is stored in gateway.env on the server, never on the desk.',
        type: 'gateway_not_configured'
      }
    });
    return;
  }
  try {
    await relay(route, req, route.grok ? withFastTier(body) : body, res);
  } catch (e) {
    if (!res.headersSent) send(res, 502, { error: { message: 'upstream-failed', type: 'bad_gateway' } });
    else res.end();
  }
});

// 双栈监听：员工端按 <主机名>.local 解析时常先拿到 IPv6 链路本地地址，只听 0.0.0.0 会被拒，桌面端要等超时重试。
server.listen({ port: PORT, host: '::', ipv6Only: false }, () => {
  process.stdout.write('LISTEN=[::]:' + PORT + ' dual-stack\n');
});
