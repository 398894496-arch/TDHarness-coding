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

function send(res, code, obj) {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': raw.length });
  res.end(raw);
}

function proxy(env, req, body) {
  const base = env.DEEPSEEK_BASE_URL || env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1';
  const key = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '';
  const u = new URL(req.url.replace(/^\/v1/, '') || '/models', base.endsWith('/') ? base : base + '/');
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
    if (row.kind === 'subscription' || row.id === 'grok' || row.id === 'chatgpt' || row.id === 'claude') continue;
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
      { id: 'grok', kind: 'subscription', label: 'Grok', bound: extras.some((r) => r && r.id === 'grok' && r.bound), vendor: 'xai' },
      { id: 'chatgpt', kind: 'subscription', label: 'ChatGPT', bound: false, hint: 'sub-use-key' },
      { id: 'claude', kind: 'subscription', label: 'Claude', bound: false, hint: 'sub-use-key' }
    ],
    models
  };
}

function handleChannels(req, body, env) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET') return { status: 200, obj: channelSnapshot(env) };
  if (method !== 'POST') return { status: 405, obj: { ok: false, error: 'method' } };
  let payload = {};
  try { payload = JSON.parse(body.toString('utf8') || '{}'); } catch (e) { payload = {}; }
  const action = String(payload.action || '');
  if (action === 'add-sub') {
    const vendor = String(payload.vendor || '').toLowerCase();
    if (vendor === 'chatgpt' || vendor === 'claude') {
      return { status: 400, obj: { ok: false, error: 'sub-use-key', hint: '账号订阅还没接通。用加入模型填 API key。' } };
    }
    if (vendor !== 'grok') return { status: 400, obj: { ok: false, error: 'sub-vendor' } };
    const rows = loadChannels().filter((r) => r && r.id !== 'grok');
    rows.push({ id: 'grok', kind: 'subscription', label: 'Grok', bound: true, vendor: 'xai' });
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
    const out = handleChannels(req, body, env);
    send(res, out.status, out.obj);
    return;
  }
  if (url === '/grok-quota' || url === '/grok-fast') {
    send(res, 200, { ok: true, enabled: false, grokBound: false, usedPercent: null, remainingPercent: null, plan: '', kind: 'key' });
    return;
  }
  const key = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '';
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
    const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : Buffer.alloc(0);
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
