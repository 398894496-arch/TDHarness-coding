'use strict';
// Company 8450 image/video door. Win only. Uses the same Grok OAuth as chat.
// Employee clients POST here. Do not put api.x.ai in the zip.

const IMAGE_MODEL = 'grok-imagine-image-2.0';
const VIDEO_MODEL = 'grok-imagine-video-1.5';
const VIDEO_TIMEOUT_MS = 600000;
const POLL_MS = 5000;

function parseBody(buf) {
  try {
    return JSON.parse(Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || ''));
  } catch {
    return null;
  }
}

function fail(res, code, msg) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: { message: String(msg || 'media-fail') } }));
}

function extOf(raw) {
  if (!raw || raw.length < 12) return { ext: 'bin', mime: 'application/octet-stream' };
  if (raw[0] === 0x89 && raw[1] === 0x50) return { ext: 'png', mime: 'image/png' };
  if (raw[0] === 0xff && raw[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  if (raw[0] === 0x52 && raw[8] === 0x57) return { ext: 'webp', mime: 'image/webp' };
  const head = raw.subarray(0, 12).toString('ascii');
  if (head.indexOf('ftyp') >= 0) return { ext: 'mp4', mime: 'video/mp4' };
  return { ext: 'bin', mime: 'application/octet-stream' };
}

function errMsg(out, fallback) {
  if (out && out.error && out.error.message) return String(out.error.message);
  return fallback;
}

async function asJson(r) {
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, body, text };
}

async function fetchBytes(upFetch, url, bearer) {
  const headers = { accept: '*/*' };
  if (bearer) headers.authorization = 'Bearer ' + bearer;
  const r = await upFetch(url, { headers });
  if (!r.ok) throw new Error('media-fetch-' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

function fileFromB64(b64, index, kindHint) {
  const raw = Buffer.from(String(b64), 'base64');
  const kind = extOf(raw);
  const ext = kind.ext === 'bin' && kindHint ? kindHint : kind.ext;
  const mime = kind.ext === 'bin' && kindHint === 'mp4' ? 'video/mp4' : kind.mime;
  return {
    name: (kindHint === 'mp4' ? 'video-' : 'image-') + (index + 1) + '.' + ext,
    mime,
    b64: raw.toString('base64')
  };
}

async function handleImages(res, body, ctx) {
  const j = parseBody(body) || {};
  const prompt = String(j.prompt || '').trim();
  if (!prompt) return fail(res, 400, 'prompt-required');
  const n = Math.min(4, Math.max(1, Number(j.n) || 1));
  const resolution = j.resolution === '2k' ? '2k' : '1k';
  const payload = {
    model: IMAGE_MODEL,
    prompt,
    n,
    resolution,
    response_format: 'b64_json'
  };
  if (typeof j.aspect_ratio === 'string' && j.aspect_ratio) payload.aspect_ratio = j.aspect_ratio;
  if (j.image) payload.image = j.image;
  const endpoint = j.image ? '/v1/images/edits' : '/v1/images/generations';
  const tok = await ctx.grokBearer();
  const r = await ctx.upFetch(ctx.grokUp() + endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + tok,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const out = await asJson(r);
  if (!out.ok) {
    ctx.note('GW_IMG status=' + out.status + ' pid=' + ctx.caller);
    return fail(res, out.status >= 400 && out.status < 600 ? out.status : 502, errMsg(out.body, 'imagine-' + out.status));
  }
  const items = (out.body && out.body.data) || [];
  const files = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].b64_json) {
      files.push(fileFromB64(items[i].b64_json, i));
      continue;
    }
    if (items[i].url) {
      const raw = await fetchBytes(ctx.upFetch, items[i].url, tok);
      const kind = extOf(raw);
      files.push({
        name: 'image-' + (i + 1) + '.' + kind.ext,
        mime: kind.mime,
        b64: raw.toString('base64')
      });
    }
  }
  if (!files.length) return fail(res, 502, 'imagine-empty');
  ctx.note('GW_IMG ok pid=' + ctx.caller + ' n=' + files.length);
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ files, model: IMAGE_MODEL }));
}

async function handleVideos(res, body, ctx) {
  const j = parseBody(body) || {};
  const prompt = String(j.prompt || '').trim();
  if (!prompt) return fail(res, 400, 'prompt-required');
  const duration = Math.min(15, Math.max(1, Number(j.duration) || 6));
  const payload = {
    model: VIDEO_MODEL,
    prompt,
    duration
  };
  if (j.image) payload.image = typeof j.image === 'string' ? { url: j.image } : j.image;
  if (typeof j.aspect_ratio === 'string' && j.aspect_ratio) payload.aspect_ratio = j.aspect_ratio;
  const tok = await ctx.grokBearer();
  const base = ctx.grokUp();
  const started = await asJson(await ctx.upFetch(base + '/v1/videos/generations', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + tok,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(payload)
  }));
  if (!started.ok) {
    ctx.note('GW_VID start=' + started.status + ' pid=' + ctx.caller);
    return fail(res, started.status >= 400 && started.status < 600 ? started.status : 502, errMsg(started.body, 'video-start-' + started.status));
  }
  const rid = started.body && (started.body.request_id || started.body.id);
  if (!rid) return fail(res, 502, 'video-no-request-id');
  let last = started.body;
  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = String(last.status || '').toLowerCase();
    if (status === 'done' || status === 'completed' || (last.video && last.video.url)) break;
    if (status === 'failed' || status === 'expired') return fail(res, 502, 'video-' + status);
    await new Promise((ok) => setTimeout(ok, POLL_MS));
    const polled = await asJson(await ctx.upFetch(base + '/v1/videos/' + encodeURIComponent(rid), {
      headers: { authorization: 'Bearer ' + tok, accept: 'application/json' }
    }));
    if (!polled.ok) return fail(res, 502, 'video-poll-' + polled.status);
    last = polled.body || {};
  }
  const videoUrl = last.video && last.video.url;
  if (!videoUrl) return fail(res, 504, 'video-timeout');
  const raw = await fetchBytes(ctx.upFetch, videoUrl, tok);
  const kind = extOf(raw);
  const ext = kind.ext === 'bin' ? 'mp4' : kind.ext;
  const mime = kind.ext === 'bin' ? 'video/mp4' : kind.mime;
  ctx.note('GW_VID ok pid=' + ctx.caller + ' bytes=' + raw.length);
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    files: [{ name: 'video-1.' + ext, mime, b64: raw.toString('base64') }],
    model: VIDEO_MODEL,
    request_id: String(rid)
  }));
}

module.exports = { handleImages, handleVideos };
