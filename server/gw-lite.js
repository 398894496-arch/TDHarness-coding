'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const ENV_PATH = process.env.TDH_GW_ENV || (ROOT + '\\runtime\\gateway.env');
const PORT = Number(process.env.TDH_GW_PORT || 8450);

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

const server = http.createServer(async (req, res) => {
  const env = loadEnv(ENV_PATH);
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok\n');
    return;
  }
  const key = env.DEEPSEEK_API_KEY || env.OPENAI_API_KEY || '';
  if (!key) {
    send(res, 503, {
      error: {
        message: 'gateway.env has no model key. Edit D:\\\\dsh\\\\runtime\\\\gateway.env then restart Autostart-Gateway.',
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
