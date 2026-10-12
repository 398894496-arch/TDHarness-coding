import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";

export const name = "company-grok-media";
export const inject = ["tools"];

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

function apply(ctx, config) {
  const door = doorOf(config);
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
