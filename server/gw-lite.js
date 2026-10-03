'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const ENV_PATH = process.env.TDH_GW_ENV || (ROOT + '\\runtime\\gateway.env');
const CHANNELS_PATH = process.env.TDH_CHANNELS || (ROOT + '\\runtime\\channels.json');
const PORT = Number(process.env.TDH_GW_PORT || 8450);
const KEY_PRESET = {
  openai: { id: 'gpt', label: 'OpenAI', up: 'https://api.openai.com/v1', env: 'OPENAI_API_KEY' },
  anthropic: { id: 'opus', label: 'Anthropic', up: 'https://api.anthropic.com', env: 'ANTHROPIC_API_KEY' },
  kimi: { id: 'kimi', label: 'Kimi', up: 'https://api.moonshot.cn/v1', env: 'KIMI_API_KEY' },
  glm: { id: 'glm', label: '智谱 GLM', up: 'https://open.bigmodel.cn/api/paas/v4', env: 'GLM_API_KEY' },
  deepseek: { id: 'deepseek', label: 'DeepSeek', up: 'https://api.deepseek.com/v1', env: 'DEEPSEEK_API_KEY' }
};

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

function loadXai() {
  try {
    const j = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf8'));
    if (!j || typeof j.access_token !== 'string' || j.access_token.length < 20) return null;
    const exp = Date.parse(j.expired || '');
    if (exp && exp < Date.now()) return null;
    return j;
  } catch (e) {
    return null;
  }
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

function listUpstream(url, token) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      path: u.pathname,
      method: 'GET',
      headers: { authorization: 'Bearer ' + token },
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

function catalogFromUpstream(rows) {
  const out = [];
  for (const row of rows) {
    const id = row && typeof row.id === 'string' ? row.id : '';
    if (!id || /imagine|image|video/i.test(id)) continue;
    const cap = row.capabilities && typeof row.capabilities === 'object' ? row.capabilities : {};
    const efforts = Array.isArray(cap.reasoning_effort) ? cap.reasoning_effort.filter((x) => typeof x === 'string' && x) : [];
    const fast = efforts.indexOf('none') >= 0;
    out.push({
      id: id,
      efforts: efforts.filter((x) => x !== 'none'),
      fast: fast,
      fastModel: /fast/i.test(id),
      fastEffort: fast ? 'none' : ''
    });
  }
  return out;
}

function deskFiles() {
  const users = (process.env.SystemDrive || 'C:') + '\\Users';
  let names = [];
  try { names = fs.readdirSync(users); } catch (e) { names = []; }
  const roots = [];
  for (const name of names) {
    roots.push(users + '\\' + name + '\\.dsh-company-rc' + '8\\desk-home');
    roots.push(users + '\\' + name + '\\TDH\\CompanyDesk\\home');
  }
  const found = [];
  for (const root of roots) {
    const rels = [
      root + '\\profiles\\web\\overlay.yml',
      root + '\\profiles\\web\\cordis.patch.yml',
      root + '\\settings.yaml'
    ];
    for (const rel of rels) if (fs.existsSync(rel)) found.push(rel);
  }
  return found;
}

function modelBlock(models, indent) {
  if (!models.length) return indent + 'models: []';
  const lines = [indent + 'models:'];
  for (const m of models) {
    lines.push(indent + '  - id: ' + m.id);
    lines.push(indent + '    name: ' + m.id);
    lines.push(indent + '    contextWindow: 256000');
    lines.push(indent + '    input: [text]');
    const efforts = [];
    if (m.fast && m.fastEffort) efforts.push(m.fastEffort);
    if (Array.isArray(m.efforts)) {
      for (const e of m.efforts) if (efforts.indexOf(e) < 0) efforts.push(e);
    }
    if (efforts.length) {
      lines.push(indent + '    reasoningEfforts:');
      for (const e of efforts) lines.push(indent + '      ' + e + ': ' + e);
    }
  }
  return lines.join('\n');
}

function replaceModels(text, anchor) {
  const lines = text.split(/\r?\n/);
  const nl = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  let anchorAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].indexOf(anchor) >= 0) { anchorAt = i; break; }
  }
  if (anchorAt < 0) return null;
  let start = -1;
  for (let i = anchorAt + 1; i < lines.length; i++) {
    if (/^- id:/.test(lines[i]) && anchor.indexOf('- id:') !== 0) break;
    if (/^\s*models:/.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return null;
  const indent = (lines[start].match(/^\s*/) || [''])[0];
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') { end++; continue; }
    const got = (line.match(/^\s*/) || [''])[0].length;
    if (got <= indent.length) break;
    end++;
  }
  return { lines: lines, start: start, end: end, indent: indent, nl: nl };
}

function setDefaultModel(id) {
  for (const file of deskFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const nl = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('agent-default-model') >= 0) { at = i; break; }
    }
    if (at < 0) continue;
    let modelAt = -1;
    for (let i = at + 1; i < lines.length; i++) {
      if (/^- id:/.test(lines[i])) break;
      if (/^\s*model:/.test(lines[i])) { modelAt = i; break; }
    }
    if (modelAt < 0) {
      if (!id) continue;
      const indent = (lines[at].match(/^\s*/) || [''])[0] + '  ';
      lines.splice(at + 1, 0, indent + 'model: ' + id);
    } else {
      const indent = (lines[modelAt].match(/^\s*/) || [''])[0];
      if (id) lines[modelAt] = indent + 'model: ' + id;
      else lines.splice(modelAt, 1);
    }
    fs.writeFileSync(file, lines.join(nl));
  }
}

function writeModels(anchor, models) {
  let n = 0;
  for (const file of deskFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    const hit = replaceModels(text, anchor);
    if (!hit) continue;
    const block = modelBlock(models, hit.indent).split('\n');
    hit.lines.splice(hit.start, hit.end - hit.start, ...block);
    fs.writeFileSync(file, hit.lines.join(hit.nl));
    n++;
  }
  return n;
}

function send(res, code, obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': raw.length });
  res.end(raw);
}

function proxy(env, req, body) {
  const model = modelName(body);
  const xai = model.indexOf('grok') === 0 ? loadXai() : null;
  const base = xai ? 'https://api.x.ai' : (env.DEEPSEEK_BASE_URL || env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1');
  const key = xai ? xai.access_token : (env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '');
  if (!key) return Promise.reject(new Error('no-key'));
  const u = xai
    ? new URL(req.url || '/v1/models', 'https://api.x.ai/')
    : new URL(req.url.replace(/^\/v1/, '') || '/models', base.endsWith('/') ? base : base + '/');
  const lib = u.protocol === 'http:' ? http : https;
  const headers = {
    'content-type': req.headers['content-type'] || 'application/json',
    authorization: 'Bearer ' + key
  };
  return new Promise((resolve, reject) => {
    const up = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method: req.method,
      headers
    }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode || 502, headers: r.headers, body: Buffer.concat(chunks) }));
    });
    up.on('error', reject);
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
    ].map((row) => row.id === 'grok' ? Object.assign({}, row, { bound: !!loadXai() }) : row),
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
    if (preset && preset.env) writeEnvLine(preset.env, key);
    else if (id === 'deepseek' || presetName === 'custom') writeEnvLine('DEEPSEEK_API_KEY', key);
    const rows = loadChannels().filter((r) => r && r.id !== id);
    rows.push({
      id,
      kind: 'key',
      label: String((preset && preset.label) || payload.id || id),
      bound: true,
      up: String((preset && preset.up) || payload.up || ''),
      models: String(payload.models || '').split(/[,\s]+/).filter(Boolean)
    });
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
    const xai = loadXai();
    if (!xai) return { status: 400, obj: { ok: false, error: 'login-not-installed', models: [] } };
    const up = await listUpstream('https://api.x.ai/v1/models', xai.access_token);
    if (up.status !== 200) return { status: 502, obj: { ok: false, error: 'upstream-' + up.status, models: [] } };
    return { status: 200, obj: { ok: true, vendor: 'grok', models: catalogFromUpstream(up.rows) } };
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
  if (action === 'apply-models') {
    const vendor = String(payload.vendor || '').toLowerCase();
    const models = Array.isArray(payload.models) ? payload.models.filter((m) => m && m.id) : [];
    const anchor = vendor === 'grok' ? 'displayName: Grok' : (vendor === 'api' ? 'llm-deepseek' : '');
    if (!anchor) return { status: 400, obj: { ok: false, error: 'vendor' } };
    const n = writeModels(anchor, models);
    if (vendor === 'grok') setDefaultModel(models.length ? models[0].id : '');
    return { status: 200, obj: { ok: n > 0, written: n, count: models.length } };
  }
  return { status: 400, obj: { ok: false, error: 'action' } };
}

const server = http.createServer(async (req, res) => {
  const env = loadEnv(ENV_PATH);
  const url = String(req.url || '').split('?')[0];
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
  if (url === '/grok-quota' || url === '/grok-fast') {
    send(res, 200, { ok: true, enabled: false, grokBound: !!loadXai(), usedPercent: null, remainingPercent: null, plan: '', kind: loadXai() ? 'oauth' : 'key' });
    return;
  }
  const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : Buffer.alloc(0);
  const model = modelName(body);
  const xai = model.indexOf('grok') === 0 ? loadXai() : null;
  const key = xai ? 'xai' : (env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '');
  if (!key) {
    send(res, 503, {
      error: {
        message: 'gateway.env has no model key. Use Settings > 模型 to add a key or subscription.',
        type: 'gateway_not_configured'
      }
    });
    return;
  }
  try {
    const up = await proxy(env, req, body);
    res.writeHead(up.status, { 'content-type': up.headers['content-type'] || 'application/json' });
    res.end(up.body);
  } catch (e) {
    send(res, 502, { error: { message: 'upstream-failed', type: 'bad_gateway' } });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write('LISTEN=0.0.0.0:' + PORT + '\n');
});
