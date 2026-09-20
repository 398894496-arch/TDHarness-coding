'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function defaultHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function credentialsPath(home = defaultHome()) {
  return path.join(home, '.credentials.yaml');
}

function parseScalar(raw) {
  const s = String(raw ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try { return JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s); } catch { return s.slice(1, -1); }
  }
  return s;
}

function indentOf(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

// Minimal YAML subset for dsh-credentials-local (version/refs/records).
function parseCredentials(text) {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const doc = { version: 1, refs: {}, records: {} };
  let section = null;
  let recordKey = null;
  let record = null;
  let inPayload = false;
  let payloadLines = [];
  const flushPayload = () => {
    if (!record || !inPayload) return;
    const joined = payloadLines.join('\n');
    try { record.payload = JSON.parse(joined); } catch {
      const obj = {};
      for (const line of payloadLines) {
        const m = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (m) obj[m[1]] = parseScalar(m[2]);
      }
      record.payload = obj;
    }
    payloadLines = [];
    inPayload = false;
  };
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = indentOf(raw);
    const line = raw.trimEnd();
    if (indent === 0 && line.startsWith('version:')) {
      doc.version = Number(parseScalar(line.slice('version:'.length))) || 1;
      continue;
    }
    if (indent === 0 && line === 'refs:') { flushPayload(); section = 'refs'; recordKey = null; continue; }
    if (indent === 0 && line === 'records:') { flushPayload(); section = 'records'; recordKey = null; continue; }
    if (section === 'refs' && indent === 2) {
      const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (m) doc.refs[m[1]] = parseScalar(m[2]);
      continue;
    }
    if (section === 'records' && indent === 2 && /:$/.test(line.trim())) {
      flushPayload();
      recordKey = line.trim().slice(0, -1);
      record = { kind: 'grant', payload: {} };
      doc.records[recordKey] = record;
      continue;
    }
    if (record && indent >= 4) {
      const t = line.trim();
      if (t.startsWith('kind:')) { record.kind = parseScalar(t.slice('kind:'.length)); continue; }
      if (t === 'payload:') { inPayload = true; payloadLines = []; continue; }
      if (inPayload) payloadLines.push(line.slice(4));
    }
  }
  flushPayload();
  return doc;
}

function dumpCredentials(doc) {
  const lines = ['version: 1', '', 'refs:'];
  const refs = doc.refs || {};
  const refKeys = Object.keys(refs).sort();
  if (!refKeys.length) lines.push('  {}');
  for (const k of refKeys) {
    const v = String(refs[k] ?? '');
    lines.push(`  ${k}: ${JSON.stringify(v)}`);
  }
  lines.push('', 'records:');
  const records = doc.records || {};
  const recKeys = Object.keys(records).sort();
  if (!recKeys.length) lines.push('  {}');
  for (const k of recKeys) {
    const rec = records[k] || {};
    lines.push(`  ${k}:`);
    lines.push(`    kind: ${rec.kind || 'grant'}`);
    const payload = rec.payload && typeof rec.payload === 'object' ? rec.payload : {};
    lines.push('    payload:');
    for (const [pk, pv] of Object.entries(payload)) {
      if (pv == null) continue;
      const printed = typeof pv === 'number' || typeof pv === 'boolean' ? String(pv) : JSON.stringify(String(pv));
      lines.push(`      ${pk}: ${printed}`);
    }
  }
  return lines.join('\n') + '\n';
}

function loadStore(file) {
  if (!fs.existsSync(file)) return { version: 1, refs: {}, records: {} };
  return parseCredentials(fs.readFileSync(file, 'utf8'));
}

function saveStore(file, doc) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, dumpCredentials(doc), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
}

function setRef(file, name, value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('invalid credential ref');
  if (!String(value ?? '').trim()) throw new Error('empty credential refused');
  const doc = loadStore(file);
  doc.refs[name] = String(value);
  saveStore(file, doc);
  return { kind: 'ref', name };
}

function unsetRef(file, name) {
  const doc = loadStore(file);
  delete doc.refs[name];
  saveStore(file, doc);
}

function setGrant(file, recordKey, payload) {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(recordKey)) throw new Error('invalid record key');
  const access = String(payload?.access ?? '').trim();
  if (!access) throw new Error('oauth grant missing access token');
  const doc = loadStore(file);
  const next = { type: 'oauth', access };
  if (payload.refresh) next.refresh = String(payload.refresh);
  if (payload.expires != null) next.expires = Number(payload.expires);
  if (payload.accountId) next.accountId = String(payload.accountId);
  doc.records[recordKey] = { kind: 'grant', payload: next };
  saveStore(file, doc);
  return { kind: 'grant', recordKey };
}

function publicView(doc) {
  return {
    refs: Object.keys(doc.refs || {}).sort(),
    records: Object.keys(doc.records || {}).sort().map((k) => ({
      key: k,
      kind: doc.records[k]?.kind || 'grant',
      type: doc.records[k]?.payload?.type || null,
      hasAccess: !!doc.records[k]?.payload?.access,
      hasRefresh: !!doc.records[k]?.payload?.refresh,
      expires: doc.records[k]?.payload?.expires ?? null,
      accountId: doc.records[k]?.payload?.accountId ?? null,
    })),
  };
}

module.exports = {
  defaultHome,
  credentialsPath,
  parseCredentials,
  dumpCredentials,
  loadStore,
  saveStore,
  setRef,
  unsetRef,
  setGrant,
  publicView,
};
