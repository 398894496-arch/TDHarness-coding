'use strict';
// L1 narrative via company 8450 grok-4.6. Runs on the server itself with the
// gateway's service token.
// Real xAI token stays in Win OAuth store. Do not call grok.exe CLI.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const MODEL = 'grok-4.6';
const DEFAULT_URL = 'http://127.0.0.1:8450/v1';
const DEFAULT_KEY = 'company-gateway';
// The gateway trusts no address, not even this machine: jobs here send the service
// token it writes at start (runtime/gw-service.token, administrators only).
function serviceKey() {
  const p = process.env.TDH_GW_SERVICE_TOKEN_FILE || path.join(process.env.TDH_ROOT || 'D:\\dsh', 'runtime', 'gw-service.token');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch (e) { return ''; }
}
const SYSTEM = [
  'You write the company org-memory daily narrative.',
  'Reply in Simplified Chinese only.',
  'Use only the given verified / in_progress / inference lines.',
  'Do not invent facts. Do not give advice. 3 to 8 sentences.'
].join(' ');

function wanted(args) {
  if (process.env.L1_DISTILL === '0') return false;
  if (args && args.distill) return true;
  return process.env.L1_DISTILL === '1';
}

function clipList(arr, n) {
  return (arr || []).slice(0, n).map((s) => String(s).slice(0, 200));
}

function promptFor(person, ymd, classified, n) {
  const v = clipList(classified && classified.verified, 20);
  const p = clipList(classified && classified.inProgress, 20);
  const inf = clipList(classified && classified.inference, 20);
  const lines = [
    'account: ' + (person && person.id ? person.id : 'unknown'),
    'dept: ' + (person && person.dept ? person.dept : 'unknown'),
    'date: ' + ymd,
    'session_count: ' + (n || 0),
    '',
    '## verified',
    ...(v.length ? v.map((s) => '- ' + s) : ['- none']),
    '',
    '## in_progress',
    ...(p.length ? p.map((s) => '- ' + s) : ['- none']),
    '',
    '## inference',
    ...(inf.length ? inf.map((s) => '- ' + s) : ['- none'])
  ];
  return lines.join('\n');
}

function parseCompletion(json) {
  const msg = json && json.choices && json.choices[0] && json.choices[0].message;
  const text = msg && msg.content;
  return String(text || '').trim();
}

function applyNarrative(body, text) {
  const safe = String(text || '').replace(/\r/g, '').trim();
  if (!safe) return body;
  const one = safe.split('\n')[0]
    .replace(/^#+\s*/, '')
    .replace(/[:#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  let out = String(body);
  if (one) out = out.replace(/^summary: .*$/m, 'summary: ' + one);
  return out.replace(/## narrative\r?\n[\s\S]*$/, '## narrative\n' + safe + '\n');
}

function curlBin() {
  return process.platform === 'win32' ? 'C:\\Windows\\System32\\curl.exe' : 'curl';
}

function completeSync(prompt, opts) {
  const fn = opts && opts.complete;
  if (typeof fn === 'function') {
    const text = String(fn(prompt) || '').trim();
    if (!text) throw new Error('empty-completion');
    return text;
  }
  const base = ((opts && opts.baseURL) || process.env.L1_DISTILL_URL || DEFAULT_URL).replace(/\/$/, '');
  const key = (opts && opts.key) || process.env.L1_DISTILL_KEY || serviceKey() || DEFAULT_KEY;
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt }
    ],
    max_tokens: 400,
    temperature: 0.2,
    stream: false
  };
  const tmp = path.join(os.tmpdir(), 'dsh-l1-distill-' + process.pid + '-' + Date.now() + '.json');
  fs.writeFileSync(tmp, JSON.stringify(body));
  const env = Object.assign({}, process.env);
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete env[k];
  }
  env.NO_PROXY = '*';
  const r = spawnSync(curlBin(), [
    '-sS', '--noproxy', '*', '--max-time', '90',
    '-H', 'Authorization: Bearer ' + key,
    '-H', 'content-type: application/json',
    '--data-binary', '@' + tmp,
    base + '/chat/completions'
  ], { encoding: 'utf8', windowsHide: true, env });
  try { fs.unlinkSync(tmp); } catch (e) {}
  if (r.status !== 0) {
    const err = String(r.stderr || r.stdout || 'curl-' + r.status).replace(/\s+/g, ' ').slice(0, 180);
    throw new Error(err || ('curl-' + r.status));
  }
  let json;
  try { json = JSON.parse(r.stdout); }
  catch (e) { throw new Error('bad-json'); }
  if (json && json.error) {
    const msg = json.error.message || json.error;
    throw new Error(String(msg).slice(0, 180));
  }
  const text = parseCompletion(json);
  if (!text) throw new Error('empty-completion');
  return text;
}

function ping() {
  const text = completeSync('\u53ea\u56de\u4e00\u4e2a\u5b57\uff1a\u597d');
  process.stdout.write('L1_DISTILL_PING_OK=1 model=' + MODEL + ' chars=' + text.length + '\n');
}

module.exports = {
  MODEL,
  wanted,
  promptFor,
  parseCompletion,
  applyNarrative,
  completeSync
};

if (require.main === module) {
  try {
    if (process.argv.indexOf('--ping') !== -1) ping();
    else {
      process.stderr.write('usage: node l1-distill.js --ping\n');
      process.exit(2);
    }
  } catch (e) {
    process.stderr.write('L1_DISTILL_PING_FAIL=' + String(e && e.message ? e.message : e).slice(0, 180) + '\n');
    process.exit(2);
  }
}
