'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.env.TDH_ROOT || 'D:\\dsh';
const BRAIN = process.env.TDH_BRAIN || path.join(ROOT, 'brain');
const PORT = Number(process.env.TDH_KNOW_PORT || 4182);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
      json(400, { ok: false, status: 'bad-request', hits: [] });
      return;
    }
    json(200, search(body.query || ''));
    return;
  }
  json(404, { status: 'not-found' });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write('LISTEN=127.0.0.1:' + PORT + '\n');
});
