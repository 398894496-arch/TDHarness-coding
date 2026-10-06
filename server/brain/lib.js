'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TZ = 'Asia/Shanghai';
const DEFAULTS = {
  brain: 'D:\\dsh\\brain',
  company: 'D:\\dsh\\company',
  homes: 'D:\\dsh\\users'
};

const ZH = {
  noActivity: '\u65e0\u53ef\u6838\u9a8c Agent \u6d3b\u52a8',
  pending: 'summary-pending',
  fact: '\u4e8b\u5b9e',
  acceptDir: '_' + String.fromCharCode(0x9A8C, 0x6536),
  passed: '03-' + String.fromCharCode(0x5DF2, 0x901A, 0x8FC7)
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') out.write = true;
    else if (a === '--allow-prod') out.allowProd = true;
    else if (a === '--evidence') out.evidence = true;
    else if (a === '--listen') out.listen = true;
    else if (a === '--distill') out.distill = true;
    else if (a === '--force-distill') out.forceDistill = true;
    else if (a === '--ping') out.ping = true;
    else if (a.startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      out[key] = argv[++i];
    } else out._.push(a);
  }
  return out;
}

function resolveRoots(args) {
  const brain = args.brainRoot || DEFAULTS.brain;
  const company = args.companyRoot || DEFAULTS.company;
  const homes = args.homesRoot || DEFAULTS.homes;
  return { brain, company, homes };
}

function printRoots(roots) {
  process.stdout.write('BRAIN_ROOT=' + roots.brain + '\n');
  process.stdout.write('COMPANY_ROOT=' + roots.company + '\n');
  process.stdout.write('HOMES_ROOT=' + roots.homes + '\n');
}

function isProdBrain(brain) {
  return String(brain).replace(/\//g, '\\').toLowerCase() === DEFAULTS.brain.toLowerCase();
}

function ensureNotProdWrite(roots, args) {
  if (args.write && isProdBrain(roots.brain) && !args.allowProd) {
    throw new Error('refusing to write production brain without --allow-prod');
  }
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function readUtf8(p) {
  return fs.readFileSync(p, { encoding: 'utf8' });
}

function writeUtf8(p, text) {
  mkdirp(path.dirname(p));
  fs.writeFileSync(p, text, { encoding: 'utf8' });
}

function appendUtf8(p, text) {
  mkdirp(path.dirname(p));
  fs.appendFileSync(p, text, { encoding: 'utf8' });
}

function loadJson(p) {
  return JSON.parse(readUtf8(p));
}

function shanghaiParts(ms) {
  const d = new Date(Number(ms));
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const map = {};
  for (const part of fmt.formatToParts(d)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const frac = String(Number(ms) % 1000).padStart(3, '0');
  return {
    ymd: map.year + '-' + map.month + '-' + map.day,
    ym: map.year + '-' + map.month,
    hm: map.hour + ':' + map.minute,
    iso: map.year + '-' + map.month + '-' + map.day + 'T' + map.hour + ':' + map.minute + ':' + map.second + '.' + frac + '+08:00'
  };
}

function shanghaiTodayMs(nowMs) {
  return shanghaiParts(nowMs == null ? Date.now() : nowMs).ymd;
}

function addDaysYmd(ymd, delta) {
  const [y, m, d] = ymd.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d + delta, 12, 0, 0);
  return shanghaiParts(utc).ymd;
}

function previousShanghaiDay(nowMs) {
  return addDaysYmd(shanghaiTodayMs(nowMs), -1);
}

function ymdRange(from, through) {
  const out = [];
  let cur = from;
  while (cur <= through) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
  }
  return out;
}

function redact(s) {
  let t = String(s == null ? '' : s);
  t = t.replace(/sk-[A-Za-z0-9]{8,}/g, '[redacted-key]');
  t = t.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]');
  t = t.replace(/cookie\s*[:=]\s*[^\s]+/gi, 'cookie=[redacted]');
  t = t.replace(/DEEPSEEK_API_KEY\s*[:=]\s*\S+/gi, 'DEEPSEEK_API_KEY=[redacted]');
  t = t.replace(/couchdb[^\s]{0,40}password[^\s]{0,80}/gi, '[redacted-pass]');
  return t;
}

function oneFact(text) {
  const t = redact(String(text || '').replace(/\s+/g, ' ').trim());
  if (!t) return 'session-opened';
  return t.slice(0, 80);
}

function isLongInstruction(text) {
  const t = String(text || '').trim();
  if (t.length > 160) return true;
  if (/\b(you are|follow these|instructions:|PLEASE_FOLLOW|system prompt)\b/i.test(t)) return true;
  return false;
}

// What the desk adds to a conversation on its own (the runtime snapshot it
// sends along with a message) is not something a person said.
function isMachineNote(ev) {
  const kind = ev && ev.data && ev.data.source && ev.data.source.kind;
  return !!kind && kind !== 'user';
}

function eventText(ev) {
  if (!ev) return '';
  const data = ev.data || {};
  let content = data.content != null ? data.content : data.message;
  // newer session files keep a model's or a tool's words one level down: data.message.content
  if (content && typeof content === 'object' && !Array.isArray(content) && content.content != null && content.text == null) content = content.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && (c.text || c.content)) || '').join(' ');
  }
  if (content && typeof content === 'object' && content.text) return content.text;
  if (typeof data.text === 'string') return data.text;
  if (data.message && typeof data.message.content === 'string') return data.message.content;
  return '';
}

// The first thing the person typed, and the last thing the model said.
function firstAsk(events) {
  for (const ev of events || []) {
    if (!ev || ev.type !== 'user/message' || isMachineNote(ev)) continue;
    const t = eventText(ev).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
}

function lastAnswer(events) {
  for (let i = (events || []).length - 1; i >= 0; i--) {
    const ev = events[i];
    if (!ev || ev.type !== 'assistant/message') continue;
    const t = eventText(ev).replace(/\s+/g, ' ').trim();
    if (t) return t;
  }
  return '';
}

function extractTitle(header, events) {
  if (header && header.title && !isLongInstruction(header.title)) {
    return oneFact(header.title);
  }
  // the desk names each conversation itself; the latest name is the best one
  let named = '';
  for (const ev of events || []) {
    if (ev && ev.type === 'session/title' && ev.data && ev.data.title) named = String(ev.data.title);
  }
  if (named) return oneFact(named);
  for (const ev of events || []) {
    if (!ev || ev.type !== 'user/message' || isMachineNote(ev)) continue;
    const t = eventText(ev);
    if (!t || isLongInstruction(t)) continue;
    return oneFact(t);
  }
  // a long brief is still what the conversation was about: its opening words
  const ask = firstAsk(events);
  return ask ? oneFact(ask) : '';
}

function extractArtifacts(events) {
  const paths = [];
  const re = /[A-Za-z]:\\[^\s`'"]+\.[A-Za-z0-9]+/g;
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.type !== 'tool/result' && ev.type !== 'tool/call') continue;
    const blob = eventText(ev) + ' ' + JSON.stringify(ev.data || {});
    const found = blob.match(re) || [];
    for (const p of found) {
      // what the work touched, not the program's own files; and a handful is enough to find the rest
      if (/node_modules|\\AppData\\|\\\.dsh|\\prefix\\|\\Windows\\/i.test(p)) continue;
      if (paths.indexOf(p) === -1) paths.push(p);
    }
  }
  return paths.slice(0, 8);
}

function correctionKind(text) {
  const t = String(text || '');
  if (/纠错|不是这个|搞错|wrong|incorrect|that is not/i.test(t)) return 'user-correction';
  return 'none';
}

function completionState(events) {
  // judged on how it ended when the ending is there: a long working session
  // says "失败" or "draft" many times along the way without ending that way
  const last = lastAnswer(events);
  const blob = last || (events || []).map((ev) => ev && ev.type + ' ' + eventText(ev)).join('\n');
  if (/partial|pending|draft|candidate|尚未|未完成|没有完成|失败|not yet/i.test(blob)) return 'partial';
  const ended = (events || []).some((ev) => ev && ev.type === 'turn/end' && ev.data && ev.data.reason && ev.data.reason.kind === 'completed');
  if (ended || /task_complete|reported-complete/i.test(blob)) return 'reported-complete';
  return 'mechanical-pass';
}

function extractFact(header, events) {
  // asked for what, and how it came out: the two ends of the conversation
  const ask = firstAsk(events);
  const end = lastAnswer(events);
  const title = extractTitle(header, events);
  // the desk's own name for the conversation is a better statement of the request than a long brief's opening words
  if (ask && end) return redact('要求：' + (title && title.length >= 4 ? title : ask.slice(0, 70)) + '｜结果：' + end.slice(0, 130));
  if (title) return title;
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.type !== 'tool/result' && ev.type !== 'turn/end') continue;
    const t = eventText(ev);
    if (!t || isLongInstruction(t)) continue;
    return oneFact(t);
  }
  return 'session-opened';
}

function walkNamed(root, name) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name === name) out.push(full);
    }
  }
  return out;
}

function zstdToUtf8(filePath) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error('zlib.zstdDecompressSync missing');
  }
  // The desk appends to a session by adding compressed frames to the end of
  // the file, and one call only opens the first frame: go on until the file
  // is used up.
  const buf = fs.readFileSync(filePath);
  const parts = [];
  let at = 0;
  while (at < buf.length) {
    const r = zlib.zstdDecompressSync(buf.subarray(at), { info: true });
    parts.push(r.buffer);
    const used = r.engine && r.engine.bytesWritten;
    if (!used) break;
    at += used;
  }
  return Buffer.concat(parts).toString('utf8');
}

function zstdFromUtf8(text) {
  if (typeof zlib.zstdCompressSync !== 'function') {
    throw new Error('zlib.zstdCompressSync missing');
  }
  return zlib.zstdCompressSync(Buffer.from(text, 'utf8'));
}

function parseSessionJsonl(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  const events = [];
  let header = null;
  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); }
    catch (e) { return { error: 'invalid-json', header: null, events: [] }; }
    if (!header && obj && (obj.type === 'session' || obj.id)) {
      header = obj;
    } else {
      events.push(obj);
    }
  }
  return { header, events, error: null };
}

function activeDays(header, events) {
  const days = new Set();
  if (header && header.createdAt) days.add(shanghaiParts(header.createdAt).ymd);
  for (const ev of events) {
    if (ev && typeof ev.time === 'number') days.add(shanghaiParts(ev.time).ymd);
  }
  return Array.from(days).sort();
}

function cwdSlug(cwd) {
  return String(cwd || 'none').replace(/[\\/:]/g, '-').replace(/-+/g, '-');
}

function loadRoster(brain) {
  const p = path.join(brain, '90-system', 'roster.json');
  if (!fs.existsSync(p)) throw new Error('roster-missing ' + p);
  return loadJson(p);
}

function rosterAccount(roster, account) {
  const acct = roster.accounts && roster.accounts[account];
  if (!acct) throw new Error('unknown-account ' + account);
  return acct;
}

function layerDir(roster, key, fallback) {
  const rel = (roster.paths && roster.paths[key]) || fallback;
  return rel;
}

function absLayer(brain, roster, key, fallback) {
  return path.join(brain, layerDir(roster, key, fallback));
}

function readFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  return out;
}

function fingerprintOk(fp) {
  return /^[a-z0-9]+(\.[a-z0-9_-]+){2,}$/.test(String(fp || ''));
}

function appendJsonl(filePath, obj) {
  appendUtf8(filePath, JSON.stringify(obj) + '\n');
}

function consecutiveFailures(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return 0;
  const lines = readUtf8(jsonlPath).split(/\r?\n/).filter(Boolean);
  let n = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const row = JSON.parse(lines[i]);
      if (row.status === 'failed' || row.status === 'degraded') n++;
      else break;
    } catch (e) { break; }
  }
  return n;
}

function nowIso() {
  return shanghaiParts(Date.now()).iso;
}

function listMd(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith('.md')) out.push(full);
    }
  }
  return out;
}

module.exports = {
  firstAsk, lastAnswer, isMachineNote,
  DEFAULTS, ZH, TZ, parseArgs, resolveRoots, printRoots, isProdBrain,
  ensureNotProdWrite, mkdirp, readUtf8, writeUtf8, appendUtf8, loadJson,
  shanghaiParts, shanghaiTodayMs, addDaysYmd, previousShanghaiDay, ymdRange,
  redact, oneFact, isLongInstruction, eventText, extractTitle, extractArtifacts,
  correctionKind, completionState, extractFact, walkNamed, zstdToUtf8, zstdFromUtf8, parseSessionJsonl,
  activeDays, cwdSlug, loadRoster, rosterAccount, layerDir, absLayer,
  readFrontmatter, fingerprintOk, appendJsonl, consecutiveFailures, nowIso,
  listMd
};
