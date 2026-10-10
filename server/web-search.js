// Web search and page fetch for the gateway: several search engines behind
// one call. The engines inside China are read the way a browser reads them
// (no account, no key); Grok's search goes through the subscription the
// gateway already holds. Each engine returns [{url, title, snippet}].
'use strict';
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const net = require('net');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function get(url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    let done = false;
    const u = new URL(url);
    // Guarded reads (gw-search /fetch): a literal private address is refused here,
    // a name is refused by opts.lookup once it resolves; both on every redirect hop.
    const bare = u.hostname.replace(/^\[|\]$/g, '');
    if (opts.guardIp && net.isIP(bare) && opts.guardIp(bare)) {
      const e = new Error('fetch-blocked');
      e.statusCode = 400;
      reject(e);
      return;
    }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(u, {
      lookup: opts.lookup,
      method: opts.method || 'GET',
      headers: Object.assign({
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
        'accept-encoding': 'gzip, deflate, br'
      }, opts.headers || {}),
      timeout: opts.timeout || 12000
    }, (res) => {
      const loc = res.headers.location;
      if (loc && res.statusCode >= 300 && res.statusCode < 400 && (opts.hops || 0) < 5) {
        res.resume();
        done = true;
        resolve(get(new URL(loc, url).toString(), Object.assign({}, opts, { hops: (opts.hops || 0) + 1, method: 'GET', body: undefined })));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size <= (opts.maxBytes || 3e6)) chunks.push(c); });
      res.on('end', () => {
        if (done) return;
        done = true;
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '');
        try {
          if (enc === 'gzip') buf = zlib.gunzipSync(buf);
          else if (enc === 'deflate') buf = zlib.inflateSync(buf);
          else if (enc === 'br') buf = zlib.brotliDecompressSync(buf);
        } catch (e) { /* a cut-off body: use what arrived */ }
        resolve({ status: res.statusCode || 0, headers: res.headers, buf, url });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// The charset a page declares, since many Chinese sites still send GBK.
function decode(res) {
  const type = String(res.headers['content-type'] || '');
  let cs = (type.match(/charset=([\w-]+)/i) || [])[1] || '';
  if (!cs) cs = (res.buf.slice(0, 2048).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1] || 'utf-8';
  cs = cs.toLowerCase();
  if (cs === 'gb2312' || cs === 'gbk') cs = 'gb18030';
  try { return new TextDecoder(cs).decode(res.buf); } catch (e) { return res.buf.toString('utf8'); }
}

function text(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(?:strong|em|b|i|font|span|mark|a)\b[^>]*>/gi, '')  // inline marks sit inside words
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, ' ').trim();
}

function clean(rows, limit) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !/^https?:\/\//.test(r.url || '') || !r.title) continue;
    // not pages: the engines' own answer boxes, video shelves, ad slots
    if (/\/\/(ai|tv|wenku|video|image|map)\.so\.com|360kan\.com|hao\.360\.com|nourl\.ubs\.baidu|recommend_list\.baidu|\/\/e\.baidu\.com|baidu\.com\/baidu\.php/.test(r.url)) continue;
    r.url = r.url.replace(/&amp;/g, '&');
    const key = r.url.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ url: r.url, title: r.title.slice(0, 160), snippet: (r.snippet || '').slice(0, 400) });
    if (out.length >= limit) break;
  }
  return out;
}

async function bing(query, limit) {
  // form/sp/qs make Bing treat this as a typed search; without them it matched only the first word
  const res = await get('https://cn.bing.com/search?q=' + encodeURIComponent(query) + '&form=QBLH&sp=-1&qs=n&count=' + Math.min(20, limit + 5), { headers: { cookie: 'MUID=1; _EDGE_S=mkt=zh-cn; SRCHHPGUSR=SRCHLANG=zh-Hans' } });
  const html = decode(res);
  const rows = [];
  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const a = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    // Bing wraps some results in its own redirect; the real address is inside, base64.
    const wrapped = url.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
    if (/bing\.com\/ck\/a/.test(url) && wrapped) {
      try { url = Buffer.from(wrapped[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (e) { /* keep the wrapped one */ }
    }
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/) || block.match(/class="b_caption"[^>]*>([\s\S]*?)<\/div>/);
    rows.push({ url, title: text(a[2]), snippet: text(p && p[1]) });
  }
  return clean(rows, limit);
}

async function baidu(query, limit) {
  const res = await get('https://www.baidu.com/s?wd=' + encodeURIComponent(query) + '&rn=' + Math.min(20, limit + 5) + '&ie=utf-8', { headers: { cookie: 'BAIDUID=' + 'A'.repeat(32) + ':FG=1' } });
  const html = decode(res);
  if (/百度安全验证|wappass\.baidu\.com/.test(html)) throw new Error('baidu-asks-for-a-human');
  const rows = [];
  for (const block of html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*c-container/).slice(1)) {
    const mu = block.match(/\bmu="([^"]+)"/);
    const a = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const sn = block.match(/class="[^"]*(?:content-right|c-abstract|summary-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div)>/);
    rows.push({ url: (mu && mu[1]) || a[1], title: text(a[2]), snippet: text(sn && sn[1]) });
  }
  return clean(rows, limit);
}

async function so360(query, limit) {
  const res = await get('https://www.so.com/s?q=' + encodeURIComponent(query));
  const html = decode(res);
  const rows = [];
  for (const block of html.split(/<li class="res-list"/).slice(1)) {
    const a = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const real = block.match(/data-mdurl="([^"]+)"/);
    const sn = block.match(/class="res-desc"[^>]*>([\s\S]*?)<\/p>/) || block.match(/class="res-rich[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    rows.push({ url: (real && real[1]) || a[1], title: text(a[2]), snippet: text(sn && sn[1]) });
  }
  return clean(rows, limit);
}

async function sogou(query, limit) {
  const res = await get('https://www.sogou.com/web?query=' + encodeURIComponent(query));
  const html = decode(res);
  if (/antispider|验证码/.test(html.slice(0, 4000))) throw new Error('sogou-asks-for-a-human');
  const rows = [];
  for (const block of html.split(/<div class="vrwrap"|<div class="rb"/).slice(1)) {
    const a = block.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, '&');
    if (url.startsWith('/link?')) url = 'https://www.sogou.com' + url;
    const sn = block.match(/class="(?:str-text-info|space-txt|ft)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/);
    rows.push({ url, title: text(a[2]), snippet: text(sn && sn[1]) });
  }
  return clean(rows, limit);
}

// Grok's own web search, through the gateway's subscription. Slow (half a
// minute or more) and thorough: it reads the pages and answers with sources.
// The desk gives any tool call one minute, so the answer has to be back well
// inside that: `ms` is how long Grok gets before the caller moves on.
function grok(query, limit, port, ms) {
  return new Promise((resolve, reject) => {
    const raw = Buffer.from(JSON.stringify({
      model: process.env.TDH_SEARCH_GROK_MODEL || 'grok-4.7',
      input: '联网检索并用简体中文回答。最多搜索 2 次，找到权威来源就停。先用两三句话给结论，再列出最权威的 3 个来源（标题、机构、年份、网址）。只引用你实际打开核对过的页面，不要编造网址。\n\n问题：' + query,
      tools: [{ type: 'web_search' }],
      stream: false
    }));
    // The gateway's own model door: it trusts no address, so send its service token.
    const headers = { 'content-type': 'application/json', 'content-length': raw.length };
    if (process.env.TDH_GW_SERVICE_TOKEN) headers.authorization = 'Bearer ' + process.env.TDH_GW_SERVICE_TOKEN;
    const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/responses', method: 'POST', headers, timeout: ms || 44000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (res.statusCode !== 200) throw new Error((j.error && (j.error.message || j.error)) || ('grok ' + res.statusCode));
          const msg = (j.output || []).filter((o) => o.type === 'message').pop();
          const part = msg && (msg.content || []).find((c) => c.type === 'output_text');
          if (!part) throw new Error('grok-no-answer');
          const rows = [];
          for (const a of part.annotations || []) if (a && a.url) rows.push({ url: a.url, title: a.title || a.url, snippet: '' });
          resolve({ content: part.text, sources: clean(rows, limit) });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('grok-timeout')));
    req.on('error', reject);
    req.end(raw);
  });
}

// One search. Everyday questions go to the engines inside China (about a
// second): 360 and Baidu together, since each misses things the other finds.
// A query that starts with 深搜 goes to Grok instead; so does one the
// engines found nothing for.
async function search(query, limit, opts) {
  opts = opts || {};
  limit = Math.max(1, Math.min(20, Number(limit) || 8));
  let q = String(query || '').trim();
  const deep = /^(深搜|深度搜索|grok)[\s:：]+/i.test(q);
  q = q.replace(/^(深搜|深度搜索|grok)[\s:：]+/i, '');
  if (!q) throw new Error('empty-query');
  if (!deep) {
    // Bing (China) and 360 answer every time; Baidu joins when it is not asking for a human
    const got = await Promise.all(['bing', 'so360', 'baidu'].map((n) => module.exports.engines[n](q, limit).catch(() => [])));
    const mixed = [];
    for (let i = 0; i < limit; i++) for (const rows of got) if (rows[i]) mixed.push(rows[i]);
    const sources = clean(mixed, limit);
    if (sources.length) {
      return { content: '境内搜索（必应中国 + 360 + 百度）。要查权威出处、论文、指南，把问题改成以「深搜 」开头再搜一次（Grok 联网检索，约 40 秒）。', sources, truncated: false };
    }
  }
  if (!opts.port) throw new Error('no-results');
  const out = await grok(q, limit, opts.port);
  return { content: out.content, sources: out.sources, truncated: false };
}

// One page, as text the model can read. Search-engine jump links are followed
// to the real page; a page in GBK is read as GBK.
async function fetchPage(url, guard) {
  const res = await get(String(url), Object.assign({ timeout: 25000, maxBytes: 4e6 }, guard || {}));
  const type = String(res.headers['content-type'] || '').toLowerCase();
  if (/pdf|octet-stream|image\/|video\/|audio\//.test(type)) {
    return { url: res.url, statusCode: res.status, body: { kind: 'text', content: '[这个地址是 ' + type + '，不是网页，读不了正文]' }, truncated: false };
  }
  let html = decode(res);
  const jump = html.length < 3000 && html.match(/(?:location\.replace|window\.location(?:\.href)?\s*=)\s*\(?["']([^"']+)["']/);
  if (jump && /^https?:/.test(jump[1])) return fetchPage(jump[1], guard);
  const cut = html.length > 400000;
  if (cut) html = html.slice(0, 400000);
  return { url: res.url, statusCode: res.status, body: { kind: /html/.test(type) || /<html/i.test(html.slice(0, 2000)) ? 'html' : 'text', content: html }, truncated: cut };
}

module.exports = { get, decode, text, clean, search, fetchPage, engines: { bing, baidu, so360, sogou, grok } };
