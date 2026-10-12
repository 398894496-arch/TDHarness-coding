export const name = "company-web-search";
export const inject = ["web"];

function doorOf(config) {
  const raw = (config && config.baseURL) || process.env.DEEPSEEK_BASE_URL || "";
  return String(raw).replace(/\/v1\/?$/, "").replace(/\/$/, "");
}

function tokenOf() {
  return process.env.DEEPSEEK_API_KEY || "";
}

async function postJson(url, body, signal) {
  const tok = tokenOf();
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (tok) headers.authorization = "Bearer " + tok;
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!r.ok) {
    const msg = (json && json.error && json.error.message) || ("company-web " + r.status);
    throw new Error(msg);
  }
  return json || {};
}

function apply(ctx, config) {
  const door = doorOf(config);
  ctx.web.registerSearchProvider({
    id: "company",
    available() { return door.length > 0; },
    async search(request, signal) {
      const out = await postJson(door + "/search", {
        query: request.query,
        maxResults: request.maxResults
      }, signal);
      return {
        content: out.content,
        sources: Array.isArray(out.sources) ? out.sources : [],
        truncated: !!out.truncated
      };
    }
  });
  ctx.web.registerFetchProvider({
    id: "company",
    available() { return door.length > 0; },
    async fetch(request, signal) {
      const out = await postJson(door + "/fetch", { url: request.url }, signal);
      return {
        url: out.url || request.url,
        statusCode: Number(out.statusCode) || 0,
        body: out.body && out.body.kind ? out.body : { kind: "text", content: "" },
        truncated: !!out.truncated
      };
    }
  });
}

export { apply };
