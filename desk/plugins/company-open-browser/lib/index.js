import { ensureDailyCdp, listPages } from "./ensure.js";
import { clickPage, formatSnapshot, navigatePage, snapshotPage, typePage } from "./cdp.js";

export const name = "company-open-browser";
export const inject = ["tools"];

const textOut = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { text: { type: "string" } },
    required: ["text"]
  },
  render(_args, value) {
    return [{ type: "text", text: value.text }];
  }
};

function pickPage(pages, targetId) {
  if (!pages.length) throw new Error("no-open-page");
  if (targetId) {
    const hit = pages.find((p) => p.id === targetId);
    if (!hit) throw new Error("page-missing:" + targetId);
    return hit;
  }
  return pages[0];
}

function tabText(pages, attach) {
  const lines = pages.map((p, i) => (i + 1) + ". " + (p.title || "") + "\n   " + (p.url || "") + "\n   id=" + p.id);
  const head = attach.relaunched
    ? "Chrome was restarted so this desk can drive the already-open profile. Tabs were restored.\n"
    : "Attached to already-open Chrome/Edge via CDP.\n";
  return head + lines.join("\n");
}

function apply(ctx) {
  ctx.tools.register({
    name: "browser_tabs",
    description: "List tabs in the employee's already-open Chrome/Edge on this machine. Cookie stays here. Not 8450. First call may bounce Chrome once so CDP can attach; session restore keeps the tabs. Use this for logged-in pages. Public URLs use web_fetch.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    timeoutMs: 45000,
    output: textOut,
    async execute() {
      const attach = await ensureDailyCdp();
      const pages = await listPages(attach.port);
      return { text: tabText(pages, attach) };
    }
  });
  ctx.tools.register({
    name: "browser_snapshot",
    description: "Text snapshot of an already-open Chrome/Edge tab on this machine. Numbered items are click/type targets. Cookie stays here. Not 8450. Optional targetId from browser_tabs.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        targetId: { type: "string", description: "Tab id from browser_tabs. Default is the first page target." }
      }
    },
    timeoutMs: 45000,
    output: textOut,
    async execute(args) {
      const attach = await ensureDailyCdp();
      const page = pickPage(await listPages(attach.port), args.targetId);
      const shot = await snapshotPage(page.webSocketDebuggerUrl);
      return { text: formatSnapshot(shot || { title: page.title, url: page.url, items: [] }) };
    }
  });
  ctx.tools.register({
    name: "browser_click",
    description: "Click a numbered item from the last browser_snapshot on the employee's already-open Chrome/Edge. Cookie stays here.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        i: { type: "integer", description: "Item number from browser_snapshot." },
        targetId: { type: "string", description: "Tab id from browser_tabs." }
      },
      required: ["i"]
    },
    timeoutMs: 45000,
    output: textOut,
    async execute(args) {
      const attach = await ensureDailyCdp();
      const page = pickPage(await listPages(attach.port), args.targetId);
      const out = await clickPage(page.webSocketDebuggerUrl, args.i);
      if (!out || !out.ok) throw new Error((out && out.error) || "click-failed");
      return { text: "clicked " + args.i + " <" + (out.tag || "") + ">" };
    }
  });
  ctx.tools.register({
    name: "browser_type",
    description: "Type into a numbered item from browser_snapshot on the employee's already-open Chrome/Edge. Cookie stays here.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        i: { type: "integer", description: "Item number from browser_snapshot." },
        text: { type: "string", description: "Text to insert." },
        targetId: { type: "string", description: "Tab id from browser_tabs." }
      },
      required: ["i", "text"]
    },
    timeoutMs: 45000,
    output: textOut,
    async execute(args) {
      const attach = await ensureDailyCdp();
      const page = pickPage(await listPages(attach.port), args.targetId);
      const out = await typePage(page.webSocketDebuggerUrl, args.i, args.text);
      if (!out || !out.ok) throw new Error((out && out.error) || "type-failed");
      return { text: "typed into " + args.i };
    }
  });
  ctx.tools.register({
    name: "browser_navigate",
    description: "Open a URL in the employee's already-open Chrome/Edge (same profile, same cookies). Cookie stays here. Not 8450.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "http(s) URL." },
        targetId: { type: "string", description: "Tab id from browser_tabs. Default is the first page target." }
      },
      required: ["url"]
    },
    timeoutMs: 45000,
    output: textOut,
    async execute(args) {
      const url = String(args.url || "");
      if (!/^https?:\/\//i.test(url)) throw new Error("url-must-be-http");
      const attach = await ensureDailyCdp();
      const page = pickPage(await listPages(attach.port), args.targetId);
      await navigatePage(page.webSocketDebuggerUrl, url);
      return { text: "navigated " + url };
    }
  });
}

export { apply };
