import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

export const name = "company-grok-media";
export const inject = ["tools", "webServer"];

function doorOf(config) {
  const raw = (config && config.baseURL) || process.env.DEEPSEEK_BASE_URL || "";
  return String(raw).replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function tokenOf() {
  return process.env.DEEPSEEK_API_KEY || "";
}

function safeStem(s, fallback) {
  const t = String(s || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return t || fallback;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function mimeOfPath(p) {
  const e = extname(String(p || "")).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".webp") return "image/webp";
  if (e === ".mp4") return "video/mp4";
  if (e === ".webm") return "video/webm";
  return "application/octet-stream";
}

function imagePayload(path) {
  const abs = String(path || "");
  if (!abs) return null;
  if (!existsSync(abs)) throw new Error("image-missing: " + basename(abs));
  const raw = readFileSync(abs);
  return { url: "data:" + mimeOfPath(abs) + ";base64," + raw.toString("base64") };
}

async function postMedia(door, path, body, timeoutMs) {
  const tok = tokenOf();
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (tok) headers.authorization = "Bearer " + tok;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(door + path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal
    });
  } finally {
    clearTimeout(t);
  }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) {
    const msg = (json && json.error && json.error.message) || ("company-media " + r.status);
    throw new Error(msg);
  }
  return json || {};
}

function writeFiles(files, stem) {
  const root = join(process.cwd(), "artifacts");
  mkdirSync(root, { recursive: true });
  const paths = [];
  const rows = Array.isArray(files) ? files : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    if (!row.b64) continue;
    const raw = Buffer.from(String(row.b64), "base64");
    const ext = extname(String(row.name || "")) || ".bin";
    const suffix = rows.length === 1 ? ext : "-" + (i + 1) + ext;
    const rel = join("artifacts", stem + suffix);
    writeFileSync(join(process.cwd(), rel), raw);
    paths.push(rel.replace(/\\/g, "/"));
  }
  if (!paths.length) throw new Error("company-media-empty");
  return paths;
}

// 局部修改（标注画布，client.js）。xAI 的改图接口没有蒙版参数：画布在浏览器里把标注区域
// 连同一圈留边裁成标准比例送来，这里转给网关改图，结果交回画布按标注形状贴回原图，
// 标注以外的像素不动。只收 data: 图片，不读也不写工作区以外的路径。
const REGION_MAX_BYTES = 30 * 1024 * 1024;
const REGION_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "2:1", "1:2"];

function readJsonBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("too-large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(new Error("bad-json")); }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function imageDataUrl(s) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ""));
  return m ? { mime: m[1], b64: m[2] } : null;
}

// 只改标注的地方：把员工的话包一层，告诉模型保持构图、透视和光影。
function regionPrompt(text) {
  return "Edit this image: " + text + "\nKeep the framing, perspective, lighting, colors and every other detail exactly as they are; change only what is asked.";
}

async function regionEdit(door, body) {
  const text = String(body.prompt || "").trim();
  if (!text) return { status: 400, body: { ok: false, error: "请写上要改成什么" } };
  if (text.length > 2000) return { status: 400, body: { ok: false, error: "说明太长了（2000 字以内）" } };
  const img = imageDataUrl(body.image);
  if (!img) return { status: 400, body: { ok: false, error: "image-missing" } };
  const payload = {
    prompt: regionPrompt(text),
    n: 1,
    resolution: body.resolution === "2k" ? "2k" : "1k",
    image: { url: "data:" + img.mime + ";base64," + img.b64 }
  };
  if (REGION_RATIOS.indexOf(body.aspect_ratio) >= 0) payload.aspect_ratio = body.aspect_ratio;
  const out = await postMedia(door, "/images", payload, 170000);
  const f = Array.isArray(out.files) ? out.files[0] : null;
  if (!f || !f.b64) return { status: 502, body: { ok: false, error: "company-media-empty" } };
  return { status: 200, body: { ok: true, mime: f.mime || "image/png", b64: f.b64 } };
}

function regionSave(body) {
  const img = imageDataUrl(body.image);
  if (!img || img.mime !== "image/png") return { status: 400, body: { ok: false, error: "image-missing" } };
  // 名字只留字母数字和 - _：不带点、不带路径符号，文件只会落在 artifacts/ 里。
  const stem = String(body.name || "").replace(/\.(png|jpe?g|webp)$/i, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
  const rel = join("artifacts", stem + "-edit-" + stamp() + ".png");
  const abs = join(process.cwd(), rel);
  mkdirSync(join(process.cwd(), "artifacts"), { recursive: true });
  writeFileSync(abs, Buffer.from(img.b64, "base64"));
  return { status: 200, body: { ok: true, path: abs } };
}

function registerRegionRoutes(ctx, door) {
  const web = typeof ctx.get === "function" ? ctx.get("webServer") : null;
  if (web == null || typeof web.register !== "function") return;
  const route = (path, run) => ctx.effect(() => web.register({
    kind: "exact",
    path,
    handler: async (req, res) => {
      if (String(req.method || "").toUpperCase() !== "POST") return sendJson(res, 405, { ok: false, error: "method" });
      let body;
      try { body = await readJsonBody(req, REGION_MAX_BYTES); } catch (e) {
        return sendJson(res, e && e.message === "too-large" ? 413 : 400, { ok: false, error: (e && e.message) || "bad-json" });
      }
      try {
        const out = await run(body || {});
        sendJson(res, out.status, out.body);
      } catch (e) {
        sendJson(res, 502, { ok: false, error: String((e && e.message) || e).slice(0, 300) });
      }
    }
  }));
  route("/company/media/region-edit", (body) => regionEdit(door, body));
  route("/company/media/region-save", async (body) => regionSave(body));
}

function apply(ctx, config) {
  const door = doorOf(config);
  registerRegionRoutes(ctx, door);
  ctx.tools.register({
    name: "generate_image",
    description: "Generate an image through the company Grok Imagine door. Writes PNG/JPEG under artifacts/ and returns those workspace-relative paths. Optional image_path edits an existing workspace image. Do not call xAI yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", description: "Scene, subject, style, and any in-image text." },
        name: { type: "string", description: "Filename stem. ASCII only. Default grok-image." },
        n: { type: "integer", description: "Variants of this prompt, 1-4. Default 1." },
        resolution: { type: "string", enum: ["1k", "2k"], description: "Default 1k. 2k takes longer." },
        aspect_ratio: { type: "string", description: "Optional, e.g. 1:1 or 16:9." },
        image_path: { type: "string", description: "Workspace image to edit. Omit for text-to-image." }
      },
      required: ["prompt"]
    },
    timeoutMs: 180000,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          paths: { type: "array", items: { type: "string" } },
          model: { type: "string" }
        },
        required: ["paths"]
      },
      render(_args, value) {
        return [{ type: "text", text: (value.paths || []).join("\n") }];
      }
    },
    async execute(args) {
      const body = {
        prompt: String(args.prompt || ""),
        n: args.n,
        resolution: args.resolution,
        aspect_ratio: args.aspect_ratio
      };
      if (args.image_path) body.image = imagePayload(args.image_path);
      const out = await postMedia(door, "/images", body, 170000);
      return {
        paths: writeFiles(out.files, safeStem(args.name, "grok-image") + "-" + stamp()),
        model: out.model || "grok-imagine-image-2.0"
      };
    }
  });
  ctx.tools.register({
    name: "generate_video",
    description: "Generate a short video through the company Grok Imagine door. Writes MP4 under artifacts/. Optional image_path is the first frame. Duration 1-15 seconds. Do not call xAI yourself.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string", description: "Motion and camera. Keep one main axis." },
        name: { type: "string", description: "Filename stem. ASCII only. Default grok-video." },
        duration: { type: "integer", description: "Seconds, 1-15. Default 6." },
        aspect_ratio: { type: "string", description: "Optional, e.g. 16:9." },
        image_path: { type: "string", description: "Still image to animate. Workspace path." }
      },
      required: ["prompt"]
    },
    timeoutMs: 600000,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          paths: { type: "array", items: { type: "string" } },
          model: { type: "string" }
        },
        required: ["paths"]
      },
      render(_args, value) {
        return [{ type: "text", text: (value.paths || []).join("\n") }];
      }
    },
    async execute(args) {
      const body = {
        prompt: String(args.prompt || ""),
        duration: args.duration,
        aspect_ratio: args.aspect_ratio
      };
      if (args.image_path) body.image = imagePayload(args.image_path);
      const out = await postMedia(door, "/videos", body, 590000);
      return {
        paths: writeFiles(out.files, safeStem(args.name, "grok-video") + "-" + stamp()),
        model: out.model || "grok-imagine-video-1.5"
      };
    }
  });
}

export { apply };
