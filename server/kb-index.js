'use strict';

// Ranked full-text search for the company knowledge base.
//
// No index server and no vectors: files are read once, cut into passages and kept in
// memory keyed by mtime + size, so a search re-reads only what changed since the last one.
// Passages are scored with BM25. Latin words and numbers are terms; Chinese (and kana /
// hangul) runs are cut into overlapping two-character terms, which is what lets 退货流程
// find a passage that says 退货 … 流程 without a dictionary. A one-character query falls
// back to single characters. The snippet is the text around the best hit, not the top of
// the file.
//
// Office files (.docx .xlsx .pptx) are opened with zlib, no extra packages. PDFs are read by
// pdf-text.mjs (vendored pdf.js) in a child process, one file at a time, and the text is
// kept in cacheDir so a restart does not read them again.
//
// OCR (when createIndex gets `ocr`, see ocr.py / install-ocr.ps1): scanned PDF pages and
// pictures of documents (.png .jpg …) go to a background queue, one job at a time, never in
// the way of a search. The result lands in cacheDir; that file is then read again and the
// next search finds its text. Until then it is counted as `ocr-pending`. Without OCR a scan
// is `pdf-no-text` and pictures are not looked at. Old binary formats (.doc .xls .ppt) are
// counted as skipped. The status route reports all of it.
//
// Old binary Office files (.doc .xls .ppt and Kingsoft's .wps .et .dps) go through the same
// queue to legacy-office.py (same venv). What a file is comes from its first bytes, not its
// name: WPS saves .wps / .et as zip by default, and a renamed .docx is still a .docx.
//
// Shared verbatim by the public server (server/kb-index.js) and the office
// (scripts/p-org-memory/kb-index.js). Keep the two copies identical.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

const TEXT_EXT = new Set(['.md', '.txt', '.csv', '.tsv']);
const ZIP_EXT = new Set(['.docx', '.xlsx', '.pptx']);
const LEGACY_EXT = new Set(['.doc', '.xls', '.ppt', '.wps', '.et', '.dps']);
const PDF_SCRIPT = path.join(__dirname, 'pdf-text.mjs');
const MAX_PDF_BYTES = 60 << 20;
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.tif', '.tiff', '.webp']);
const MIN_IMG_BYTES = 20 << 10;
const MAX_IMG_BYTES = 25 << 20;
const OCR_TIMEOUT_MS = 30 * 60 * 1000;
// Bump when what is cached changes shape (v2: scanned pages are marked for OCR).
const CACHE_VERSION = 'v2';
const MAX_TEXT_BYTES = 4 << 20;
const MAX_ZIP_BYTES = 40 << 20;
const MAX_EXTRACT_CHARS = 2 << 20;
const MAX_FILES_PER_ROOT = 20000;
const PASSAGE_CHARS = 700;
const K1 = 1.2;
const B = 0.75;

// ---------- terms ----------

const RUN_RE = /([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]+)|([\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}_]+)/gu;

function norm(text) {
  return String(text || '').normalize('NFKC').toLowerCase();
}

// Terms for indexing: CJK bigrams and single characters, Latin words.
function indexTerms(text) {
  const out = [];
  const s = norm(text);
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(s))) {
    if (m[1]) {
      const r = Array.from(m[1]);
      for (let i = 0; i < r.length; i++) {
        out.push(r[i]);
        if (i + 1 < r.length) out.push(r[i] + r[i + 1]);
      }
    } else if (m[2].length >= 2 || /\d/.test(m[2])) {
      out.push(m[2]);
    }
  }
  return out;
}

// Question words carry no topic: 客户要退款怎么处理 is about 客户 / 退款, not 怎么.
const QUERY_STOP = new Set(['怎么', '么处', '么办', '什么', '如何', '为什', '么样', '哪些', '哪里', '哪个', '是否', '可以',
  '能否', '一下', '是不', '不是', '我们', '你们', '他们', '这个', '那个', '的是', '是谁', '谁来', '有没', '没有', '请问',
  '能不', '不能', '应该', '现在', '到底', '我的', '你的', '要不', '不要', '还是', '多少', '关于', '帮我', '一个',
  'how', 'what', 'the', 'is', 'are', 'do', 'does', 'to', 'of', 'and', 'in', 'for']);

// Terms for a query: bigrams for runs of two or more characters, the character itself
// for a run of one. Each term once, question words left out unless nothing else is left.
function queryTerms(text) {
  const out = [];
  const seen = new Set();
  const add = (t) => { if (!seen.has(t)) { seen.add(t); out.push(t); } };
  const all = queryTermsAll(text, add, out);
  const kept = all.filter((t) => !QUERY_STOP.has(t));
  return kept.length ? kept : all;
}

function queryTermsAll(text, add, out) {
  const s = norm(text);
  RUN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_RE.exec(s))) {
    if (m[1]) {
      const r = Array.from(m[1]);
      if (r.length === 1) add(r[0]);
      for (let i = 0; i + 1 < r.length; i++) add(r[i] + r[i + 1]);
    } else if (m[2].length >= 2 || /\d/.test(m[2])) {
      add(m[2]);
    }
  }
  return out;
}

// ---------- refusing instead of guessing (after DSH-KRouter) ----------
//
// A question about something the files never mention must get nothing: on the desk, nothing
// lets the agent search the web, while a weak hit stops it at the wrong page. The question is
// cut into two-character words (a general word list plus the words the files use), and the
// first hit is refused when the question's specific words that occur nowhere outnumber the
// ones that hit, e.g. 外贸报关流程 against a page about 发货流程, or 公司年会 against a page
// that only says 公司. The word list is jieba's (MIT), as DSH-KRouter publishes it.

const LEXICON_FILE = path.join(__dirname, 'kb-lexicon.txt');
const GENERIC_WORDS = 1000;
// A two-character piece holding one of these is part of the question, not its subject.
const QUESTION_CHARS = /[的了吗呢吧啊么什哪几谁怎啥呀]/;
let lexiconCache = null;

function lexicon() {
  if (!lexiconCache) {
    let words = [];
    try { words = fs.readFileSync(LEXICON_FILE, 'utf8').split(/\r?\n/).filter((w) => w && w.charAt(0) !== '#'); } catch (e) { /* no list: corpus words only */ }
    lexiconCache = { known: new Set(words), generic: new Set(words.slice(0, GENERIC_WORDS)) };
  }
  return lexiconCache;
}

// The question's Chinese as known two-character words, left to right; whatever lies between
// known words is one unknown piece (机除垢 in 咖啡机除垢周期), not cut into made-up pairs.
function questionWords(raw, inCorpus) {
  const { known } = lexicon();
  const isWord = (w) => known.has(w) || inCorpus(w);
  const out = [];
  for (const run of norm(raw).match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g) || []) {
    const r = Array.from(run);
    let loose = '';
    const flush = () => { if (Array.from(loose).length >= 2) out.push(loose); loose = ''; };
    let i = 0;
    while (i < r.length) {
      const here = i + 1 < r.length ? r[i] + r[i + 1] : '';
      if (here && isWord(here)) { flush(); out.push(here); i += 2; continue; }
      loose += r[i];
      i += 1;
    }
    flush();
  }
  return out;
}

function refuses(raw, df, topText) {
  const { generic } = lexicon();
  // A piece is somewhere in the files when each of its two-character parts is.
  const somewhere = (w) => { const r = Array.from(w); for (let i = 0; i + 1 < r.length; i++) if (!((df.get(r[i] + r[i + 1]) || 0) > 0)) return false; return true; };
  const specific = [...new Set(questionWords(raw, (w) => (df.get(w) || 0) > 0))]
    .filter((w) => !generic.has(w) && !QUERY_STOP.has(w) && !QUESTION_CHARS.test(w));
  const top = norm(topText).replace(/\s+/g, '');
  const absent = specific.filter((w) => !somewhere(w));
  const onTop = specific.filter((w) => somewhere(w) && top.indexOf(w) >= 0);
  if (absent.length > onTop.length && (absent.length >= 2 || onTop.length === 0)) return true;
  // A longer question whose first hit covers less than half of what it asks about.
  return specific.length >= 3 && onTop.length * 2 < specific.length;
}

// ---------- files ----------

function decodeXml(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (all, e) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    try { return String.fromCodePoint(n); } catch (err) { return ''; }
  });
}

// Minimal zip reader: central directory, stored or deflated members.
function zipMembers(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip-no-directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip-bad-directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    out.set(name, { method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: Array.from(out.keys()),
    read(name) {
      const e = out.get(name);
      if (!e) return null;
      const lp = e.local;
      if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error('zip-bad-entry');
      const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return raw.toString('utf8');
      if (e.method === 8) return zlib.inflateRawSync(raw).toString('utf8');
      throw new Error('zip-method-' + e.method);
    },
  };
}

function xmlParagraphs(xml, para, run) {
  // One line per paragraph; tabs and breaks kept; every other tag dropped.
  return decodeXml(xml
    .replace(new RegExp('</' + para + '>', 'g'), '\n')
    .replace(/<w:tab\/>|<a:tab\/>/g, '\t')
    .replace(/<w:br\/>|<a:br\/>/g, '\n')
    .replace(new RegExp('<(?!/?' + run + '[ >])[^>]*>', 'g'), '')
    .replace(new RegExp('</?' + run + '(?: [^>]*)?>', 'g'), ''));
}

function byNumber(a, b) {
  const na = Number((a.match(/(\d+)\.xml$/) || [])[1] || 0);
  const nb = Number((b.match(/(\d+)\.xml$/) || [])[1] || 0);
  return na - nb;
}

function docxText(z) {
  return xmlParagraphs(z.read('word/document.xml') || '', 'w:p', 'w:t');
}

function pptxText(z) {
  const slides = z.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(byNumber);
  return slides.map((n, i) => '## 第 ' + (i + 1) + ' 页\n' + xmlParagraphs(z.read(n) || '', 'a:p', 'a:t')).join('\n');
}

function xlsxText(z) {
  const shared = [];
  const sx = z.read('xl/sharedStrings.xml') || '';
  for (const si of sx.match(/<si>[\s\S]*?<\/si>/g) || []) {
    shared.push(decodeXml((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  }
  const names = [];
  for (const m of (z.read('xl/workbook.xml') || '').matchAll(/<sheet [^>]*name="([^"]*)"/g)) names.push(decodeXml(m[1]));
  const sheets = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort(byNumber);
  const lines = [];
  sheets.forEach((n, i) => {
    lines.push('## ' + (names[i] || 'Sheet' + (i + 1)));
    let rows = 0;
    for (const row of (z.read(n) || '').match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
      const cells = [];
      for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const t = (c.match(/^<c [^>]*\bt="([^"]+)"/) || [])[1] || '';
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (t === 's' && v != null) cells.push(shared[Number(v)] || '');
        else if (t === 'inlineStr') cells.push(decodeXml((c.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || ''));
        else if (v != null) cells.push(decodeXml(v));
      }
      if (cells.some((x) => x !== '')) lines.push(cells.join(' | '));
      if (++rows >= 5000) break;
    }
  });
  return lines.join('\n');
}

function skip(reason) {
  const e = new Error(reason);
  e.reason = reason;
  return e;
}

function cacheKey(full, st) {
  return crypto.createHash('sha1').update(CACHE_VERSION + '|' + full + '|' + st.mtimeMs + '|' + st.size).digest('hex');
}

// A background job's result once it has finished: OCR { pages: { '1': text } }, legacy
// { text }, either { error }.
function jobResult(ctx, key, kind) {
  if (!ctx.cacheDir) return null;
  try { return JSON.parse(fs.readFileSync(path.join(ctx.cacheDir, key + '.' + kind + '.json'), 'utf8')); } catch (e) { return null; }
}

function head(full, n) {
  const fd = fs.openSync(full, 'r');
  try {
    const b = Buffer.alloc(n);
    return b.subarray(0, fs.readSync(fd, b, 0, n, 0));
  } finally { fs.closeSync(fd); }
}

const OLE_MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');

// The company's own synonyms, one group per line: 报销 = 费用核销, 报账. Not indexed itself.
const SYNONYM_FILE = /^(同义词|synonyms)\.txt$/i;

// Put OCR text into the pages pdf-text.mjs marked; list the pages still without any.
function applyOcr(text, pages) {
  const need = [];
  const blocks = text.split(/\n*(?=^## 第 \d+ 页$)/m);
  const out = [];
  for (const b of blocks) {
    const m = b.match(/^## 第 (\d+) 页\n@@ocr-needed\s*$/);
    if (!m) { out.push(b); continue; }
    const got = pages && pages[m[1]];
    if (got && got.trim()) out.push('## 第 ' + m[1] + ' 页\n' + got.trim());
    else if (!pages) need.push(Number(m[1]));
  }
  return { text: out.join('\n\n'), need };
}

// PDF text through pdf-text.mjs, cached on disk by path, mtime and size.
function pdfText(full, st, cacheDir) {
  if (st.size > MAX_PDF_BYTES) throw skip('too-large');
  if (!fs.existsSync(PDF_SCRIPT)) throw skip('.pdf');
  let cached = '';
  if (cacheDir) {
    cached = path.join(cacheDir, cacheKey(full, st) + '.txt');
    try { return fs.readFileSync(cached, 'utf8'); } catch (e) { /* not read yet */ }
  }
  const r = spawnSync(process.execPath, [PDF_SCRIPT, full], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 << 20, windowsHide: true });
  if (r.status !== 0) throw skip(r.status === 2 ? 'pdf-unreadable' : 'pdf-failed');
  const text = String(r.stdout || '');
  if (cached) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cached, text); } catch (e) { /* read again next time */ }
  }
  return text;
}

// The text of a file. Throws (with .reason) when it cannot be read (yet).
// ctx: { cacheDir, ocr } where ocr.enqueue(full, pages, key) asks for a background job.
function fileText(full, st, ctx) {
  const size = st.size;
  const cacheDir = ctx.cacheDir;
  const ext = path.extname(full).toLowerCase();
  if (TEXT_EXT.has(ext)) {
    if (size > MAX_TEXT_BYTES) throw skip('too-large');
    return fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
  }
  if (ext === '.pdf') {
    const key = cacheKey(full, st);
    const res = ctx.ocr ? jobResult(ctx, key, 'ocr') : null;
    const got = applyOcr(pdfText(full, st, cacheDir), res && !res.error ? res.pages : (res ? {} : null));
    if (got.need.length && ctx.ocr) ctx.ocr.enqueue(full, got.need, key);
    if (!got.text.replace(/^## 第 \d+ 页$/gm, '').trim()) {
      throw skip(res && res.error ? 'ocr-failed' : got.need.length ? (ctx.ocr ? 'ocr-pending' : 'pdf-no-text') : 'pdf-no-text');
    }
    return got.text;
  }
  if (IMG_EXT.has(ext)) {
    if (!ctx.ocr) throw skip(ext);
    if (size > MAX_IMG_BYTES) throw skip('too-large');
    const key = cacheKey(full, st);
    const res = jobResult(ctx, key, 'ocr');
    if (!res) { ctx.ocr.enqueue(full, [1], key); throw skip('ocr-pending'); }
    if (res.error) throw skip('ocr-failed');
    const text = String((res.pages || {})['1'] || '').trim();
    if (!text) throw skip('ocr-no-text');
    return '## 图片\n' + text;
  }
  if (ZIP_EXT.has(ext) || LEGACY_EXT.has(ext)) {
    if (size > MAX_ZIP_BYTES) throw skip('too-large');
    const h = head(full, 8);
    if (h[0] === 0x50 && h[1] === 0x4b) {
      const z = zipMembers(fs.readFileSync(full));
      const has = (n) => z.names.indexOf(n) >= 0;
      const text = has('word/document.xml') ? docxText(z) : has('xl/workbook.xml') ? xlsxText(z)
        : z.names.some((n) => /^ppt\/slides\//.test(n)) ? pptxText(z) : null;
      if (text == null) throw skip('unknown-zip');
      return text.slice(0, MAX_EXTRACT_CHARS);
    }
    if (h.equals(OLE_MAGIC)) {
      if (!ctx.legacy) throw skip(ext);
      const key = cacheKey(full, st);
      const res = jobResult(ctx, key, 'legacy');
      if (!res) { ctx.legacy.enqueue(full, key); throw skip('legacy-pending'); }
      if (res.error) throw skip(/encrypted/i.test(res.error) ? 'encrypted' : 'legacy-failed');
      const text = String(res.text || '');
      if (!text.trim()) throw skip('no-text');
      return text.slice(0, MAX_EXTRACT_CHARS);
    }
    throw skip('unknown-format');
  }
  throw skip(ext || 'no-extension');
}

function frontmatter(lines) {
  const fm = {};
  if (lines[0] !== '---') return { fm, body: 0 };
  let i = 1;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return { fm, body: i < lines.length ? i + 1 : 0 };
}

function addPassage(doc, line, text, section) {
  const t = text.trim();
  if (!t) return;
  const terms = indexTerms(t);
  if (!terms.length) return;
  const tf = new Map();
  for (const x of terms) tf.set(x, (tf.get(x) || 0) + 1);
  doc.passages.push({ line, text: t, tf, len: terms.length, section: section || '' });
}

function buildDoc(full, text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const { fm, body } = frontmatter(lines);
  const doc = { fm, passages: [], title: '' };
  const heading = lines.slice(body).find((l) => /^#{1,3}\s/.test(l));
  doc.title = fm.title || (heading ? heading.replace(/^#+\s*/, '') : '') || path.basename(full, path.extname(full));
  doc.titleTerms = new Set(indexTerms(path.basename(full, path.extname(full)) + ' ' + doc.title));
  if (fm.summary) addPassage(doc, 1 + lines.indexOf(lines.find((l) => /^summary:/.test(l))), fm.summary);
  let start = body + 1;
  let buf = [];
  let chars = 0;
  // The heading a passage sits under: the page of a PDF or deck, the sheet of a workbook.
  let section = '';
  let bufSection = '';
  const flush = (next) => {
    addPassage(doc, start, buf.join('\n'), bufSection);
    buf = [];
    chars = 0;
    start = next;
  };
  for (let i = body; i < lines.length; i++) {
    const l = lines[i];
    const n = i + 1;
    if (!l.trim()) { if (buf.length) flush(n + 1); else start = n + 1; continue; }
    if (/^#{1,6}\s/.test(l)) {
      if (buf.length) flush(n);
      section = l.replace(/^#+\s*/, '').trim();
    }
    if (!buf.length) { start = n; bufSection = section; }
    buf.push(l);
    chars += l.length;
    if (chars >= PASSAGE_CHARS) flush(n + 1);
  }
  if (buf.length) flush(lines.length + 1);
  return doc;
}

// ---------- index ----------

function createIndex(opts) {
  const o = opts || {};
  const skipDir = o.skipDir || ((name) => name.charAt(0) === '.' || name === 'node_modules');
  const cacheDir = o.cacheDir || '';
  // OCR needs somewhere to put results: { exe, args } runs `exe ...args --file --pages --out`.
  const ocrCfg = o.ocr && o.ocr.exe && cacheDir ? o.ocr : null;
  // Old Office files: { exe, args } runs `exe ...args --file --out`.
  const legacyCfg = o.legacy && o.legacy.exe && cacheDir ? o.legacy : null;
  const queue = [];
  const queued = new Set();
  let running = null;
  const finished = { ocr: { done: 0, failed: 0 }, legacy: { done: 0, failed: 0 } };
  const cache = new Map();
  const skipped = new Map();

  function walk(root, out) {
    let st;
    try { st = fs.statSync(root); } catch (e) { return; }
    if (st.isFile()) { out.push({ full: root, st }); return; }
    const stack = [root];
    let n = 0;
    while (stack.length && n < MAX_FILES_PER_ROOT) {
      const dir = stack.pop();
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const ent of ents) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) { if (!skipDir(ent.name, full)) stack.push(full); continue; }
        if (!ent.isFile() || ent.name.charAt(0) === '~' || SYNONYM_FILE.test(ent.name)) continue;
        const ext = path.extname(ent.name).toLowerCase();
        const img = IMG_EXT.has(ext);
        if (img && (!ocrCfg || ent.name.charAt(0) === '.')) continue;
        if (!TEXT_EXT.has(ext) && !ZIP_EXT.has(ext) && !LEGACY_EXT.has(ext) && ext !== '.pdf' && !img) continue;
        try {
          const st = fs.statSync(full);
          if (img && st.size < MIN_IMG_BYTES) continue;
          out.push({ full, st });
          n++;
        } catch (e) { /* gone */ }
      }
    }
  }

  // One background job at a time (OCR or an old Office file). When it ends, well or not,
  // the result file exists and the file is read again with its text.
  function enqueue(kind, full, pages, key) {
    if (queued.has(kind + key)) return;
    queued.add(kind + key);
    queue.push({ kind, full, pages, key });
    pump();
  }

  function pump() {
    if (running || !queue.length) return;
    const job = queue.shift();
    running = job;
    const out = path.join(cacheDir, job.key + '.' + job.kind + '.json');
    const cfg = job.kind === 'ocr' ? ocrCfg : legacyCfg;
    const extra = job.kind === 'ocr' ? ['--file', job.full, '--pages', job.pages.join(','), '--out', out] : ['--file', job.full, '--out', out];
    let ended = false;
    let timer = null;
    const end = (why) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      if (!fs.existsSync(out)) {
        try { fs.writeFileSync(out, JSON.stringify({ error: why })); } catch (e) { /* tried again after a restart */ }
      }
      let ok = false;
      try { ok = !JSON.parse(fs.readFileSync(out, 'utf8')).error; } catch (e) { ok = false; }
      finished[job.kind][ok ? 'done' : 'failed']++;
      queued.delete(job.kind + job.key);
      running = null;
      // Read the file again now, with its text, so status and the next search are current.
      cache.delete(job.full);
      try { load(job.full, fs.statSync(job.full)); } catch (e) { skipped.delete(job.full); }
      setImmediate(pump);
    };
    let child;
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      child = spawn(cfg.exe, (cfg.args || []).concat(extra), { stdio: 'ignore', windowsHide: true });
    } catch (e) {
      end('spawn ' + e.message);
      return;
    }
    timer = setTimeout(() => { try { child.kill(); } catch (e) { /* gone */ } }, OCR_TIMEOUT_MS);
    child.on('error', (e) => end('spawn ' + e.message));
    child.on('exit', (code) => end('exit ' + code));
  }

  const ctx = {
    cacheDir,
    ocr: ocrCfg ? { enqueue: (full, pages, key) => enqueue('ocr', full, pages, key) } : null,
    legacy: legacyCfg ? { enqueue: (full, key) => enqueue('legacy', full, [], key) } : null,
  };

  function load(full, st) {
    const key = st.mtimeMs + ':' + st.size;
    const hit = cache.get(full);
    if (hit && hit.key === key) return hit.doc;
    let doc = null;
    try {
      doc = buildDoc(full, fileText(full, st, ctx));
    } catch (e) {
      skipped.set(full, e.reason || 'unreadable');
    }
    cache.set(full, { key, doc });
    if (doc) skipped.delete(full);
    return doc;
  }

  // Every readable file under the roots, deduplicated, each once.
  function docs(roots, allow) {
    const seen = new Set();
    const out = [];
    for (const root of roots) {
      const files = [];
      walk(root, files);
      for (const f of files) {
        if (seen.has(f.full)) continue;
        seen.add(f.full);
        const doc = load(f.full, f.st);
        if (!doc || !doc.passages.length) continue;
        if (allow && !allow(f.full, doc.fm)) continue;
        out.push({ full: f.full, doc });
      }
    }
    return out;
  }

  // queries: the question first, then any aliases; a passage scores by its best one.
  // Returns [{ full, line, text, score, title, fm }], best first, at most perFile per file.
  // Synonym groups from 同义词.txt / synonyms.txt directly inside the given folders.
  function synonyms(roots) {
    const groups = [];
    for (const root of roots) {
      let names = [];
      try { names = fs.readdirSync(root).filter((n) => SYNONYM_FILE.test(n)); } catch (e) { continue; }
      for (const n of names) {
        let text = '';
        try { text = fs.readFileSync(path.join(root, n), 'utf8').replace(/^\uFEFF/, ''); } catch (e) { continue; }
        for (const line of text.split(/\r?\n/)) {
          const words = line.replace(/#.*$/, '').split(/[=,，、;；|]/).map((w) => norm(w).trim()).filter(Boolean);
          if (words.length >= 2) groups.push(words);
        }
      }
    }
    return groups;
  }

  // The question, and the same question with each synonym in place of the word it asked with.
  // Each variant remembers the word it replaced, so a word the files never use can drop out.
  function expand(queries, groups) {
    const out = queries.map((q) => ({ text: q, from: '', to: '' }));
    const first = norm(queries[0] || '');
    for (const g of groups || []) {
      for (const w of g) {
        if (!w || first.indexOf(w) < 0) continue;
        for (const o of g) if (o !== w && out.length < 9) out.push({ text: first.split(w).join(o), from: w, to: o });
      }
    }
    const seen = new Set();
    return out.filter((q) => !seen.has(q.text) && seen.add(q.text));
  }

  function search(roots, queries, sopts) {
    const so = sopts || {};
    const limit = so.limit || 24;
    const perFile = so.perFile || 3;
    const asked = expand(Array.isArray(queries) ? queries : [queries], so.synonyms);
    let qs = asked.map((q) => ({ raw: norm(q.text).replace(/\s+/g, ''), terms: queryTerms(q.text), from: q.from, to: q.to }))
      .filter((q) => q.terms.length);
    if (!qs.length) return [];
    const all = docs(roots, so.allow);
    let N = 0;
    let total = 0;
    const df = new Map();
    const wanted = new Set();
    for (const q of qs) for (const t of q.terms) wanted.add(t);
    // The question's own words too (stop words and all), for refusing below.
    for (const q of qs) for (const t of indexTerms(q.raw)) wanted.add(t);
    for (const q of qs) for (const t of indexTerms(q.from + q.to)) wanted.add(t);
    for (const { doc } of all) {
      for (const p of doc.passages) {
        N++;
        total += p.len;
        for (const t of wanted) if (p.tf.has(t)) df.set(t, (df.get(t) || 0) + 1);
      }
    }
    if (!N) return [];
    // When the question's word occurs nowhere and a synonym of it does, ask with the synonym only.
    const nowhere = (w) => { const ts = indexTerms(w); return ts.filter((x) => x.length >= 2 || ts.length === 1).some((x) => !df.has(x)); };
    if (qs.some((q) => q.from && nowhere(q.from) && !nowhere(q.to))) qs = qs.filter((q) => q.from && nowhere(q.from) && !nowhere(q.to));
    if (!qs.length) return [];
    const avg = total / N;
    const idf = (t) => { const d = df.get(t) || 0; return Math.log(1 + (N - d + 0.5) / (d + 0.5)); };
    // Coverage counts only terms that occur somewhere: in 运费是谁来承担的, 是谁 / 谁来 are
    // nowhere in the files and must not count against a passage that has 运费 and 承担.
    for (const q of qs) {
      q.live = q.terms.filter((t) => df.has(t));
      q.liveW = q.live.reduce((a, t) => a + idf(t), 0);
    }
    const scored = [];
    for (const { full, doc } of all) {
      for (const p of doc.passages) {
        let best = 0;
        let bestTerm = '';
        let bestQ = null;
        for (const q of qs) {
          let s = 0;
          let have = 0;
          let haveW = 0;
          let top = '';
          let topIdf = -1;
          for (const t of q.terms) {
            const f = p.tf.get(t);
            if (!f) continue;
            have++;
            const w = idf(t);
            haveW += w;
            s += w * (f * (K1 + 1)) / (f + K1 * (1 - B + B * p.len / avg));
            if (w > topIdf) { topIdf = w; top = t; }
          }
          if (!have) continue;
          // Coverage weighted by rarity: missing 退款 costs more than missing 客户.
          const cover = haveW / q.liveW;
          if (q.live.length > 1 && cover < 0.5) continue;
          s *= cover * cover;
          if (q.raw.length >= 2 && norm(p.text).replace(/\s+/g, '').indexOf(q.raw) >= 0) s *= 1.6;
          // The synonym stands for what the person asked about: weigh the passages that use it.
          if (q.to && norm(p.text).indexOf(q.to) >= 0) s *= 1.5;
          let inTitle = 0;
          for (const t of q.terms) if (doc.titleTerms.has(t)) inTitle++;
          s *= 1 + 0.5 * (inTitle / q.live.length);
          if (s > best) { best = s; bestQ = q; bestTerm = q.raw.length >= 2 && norm(p.text).replace(/\s+/g, '').indexOf(q.raw) >= 0 ? q.raw : top; }
        }
        if (best > 0) scored.push({ full, doc, p, score: best, term: bestTerm, q: bestQ });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    if (scored.length && so.refuse !== false) {
      if (refuses(scored[0].q.raw, df, scored[0].p.text)) {
        const none = [];
        none.refused = 'off-topic';
        return none;
      }
    }
    const per = new Map();
    const out = [];
    for (const s of scored) {
      const n = per.get(s.full) || 0;
      if (n >= perFile) continue;
      per.set(s.full, n + 1);
      const snip = snippet(s.p, s.term);
      out.push({ full: s.full, line: snip.line, text: snip.text, section: s.p.section, score: Math.round(s.score * 100) / 100, title: s.doc.title, fm: s.doc.fm });
      if (out.length >= limit) break;
    }
    return out;
  }

  // The first passages of one file, for a named path with no match.
  function preview(full, limit) {
    let st;
    try { st = fs.statSync(full); } catch (e) { return []; }
    const doc = load(full, st);
    if (!doc) return [];
    return doc.passages.slice(0, limit || 3).map((p) => ({ full, line: p.line, text: clip(p.text, 0, 300), section: p.section, title: doc.title, fm: doc.fm }));
  }

  function stats() {
    let files = 0;
    let passages = 0;
    for (const v of cache.values()) if (v.doc) { files++; passages += v.doc.passages.length; }
    const byExt = {};
    for (const why of skipped.values()) byExt[why] = (byExt[why] || 0) + 1;
    // queued / running count every background job, OCR and old Office files alike.
    const jobs = { queued: queue.length, running: running ? 1 : 0 };
    const ocr = ocrCfg ? { on: true, ...jobs, ...finished.ocr } : { on: false };
    const legacy = legacyCfg ? { on: true, ...jobs, ...finished.legacy } : { on: false };
    return { files, passages, skipped: byExt, ocr, legacy };
  }

  return { search, synonyms, preview, docs, stats, fileText: (full) => fileText(full, fs.statSync(full), ctx), idle: () => !running && !queue.length };
}

function clip(text, at, width) {
  const s = text.replace(/\s+/g, ' ');
  if (s.length <= width) return s;
  let a = Math.max(0, at - 40);
  if (a + width > s.length) a = Math.max(0, s.length - width);
  return (a > 0 ? '…' : '') + s.slice(a, a + width) + (a + width < s.length ? '…' : '');
}

// The text around the term, with the line it sits on.
function snippet(p, term) {
  const low = norm(p.text);
  let at = term ? low.indexOf(term) : -1;
  if (at < 0) {
    const compact = low.replace(/\s+/g, '');
    const k = term ? compact.indexOf(term) : -1;
    if (k >= 0) {
      let seen = 0;
      for (at = 0; at < low.length && seen < k; at++) if (!/\s/.test(low[at])) seen++;
    } else at = 0;
  }
  const line = p.line + (p.text.slice(0, at).match(/\n/g) || []).length;
  const before = p.text.slice(0, at).replace(/\s+/g, ' ').length;
  return { line, text: clip(p.text, before, 300) };
}

module.exports = { createIndex, indexTerms, queryTerms, fileText, zipMembers };
