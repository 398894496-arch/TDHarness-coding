const SNAPSHOT_JS = `(() => {
  const sel = 'a, button, input, textarea, select, [role="button"], [role="link"], [onclick], [contenteditable="true"]';
  const nodes = Array.from(document.querySelectorAll(sel)).filter((el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width >= 2 && r.height >= 2 && st.visibility !== "hidden" && st.display !== "none";
  }).slice(0, 80);
  const items = nodes.map((el, i) => {
    el.setAttribute("data-dsh-open", String(i + 1));
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    return { i: i + 1, tag: el.tagName.toLowerCase(), type: el.type || "", text, href: el.href || "" };
  });
  return {
    title: document.title,
    url: location.href,
    items
  };
})()`;

function clickJs(i) {
  return `(() => {
    const el = document.querySelector('[data-dsh-open="${Number(i)}"]');
    if (!el) return { ok: false, error: "no-item-" + ${Number(i)} };
    el.focus();
    el.click();
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`;
}

function typeJs(i, text) {
  const q = JSON.stringify(String(text));
  return `(() => {
    const el = document.querySelector('[data-dsh-open="${Number(i)}"]');
    if (!el) return { ok: false, error: "no-item-" + ${Number(i)} };
    el.focus();
    if ("value" in el) {
      el.value = ${q};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.textContent = ${q};
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { ok: true, tag: el.tagName.toLowerCase() };
  })()`;
}

export function formatSnapshot(page) {
  const items = (page.items || []).map((it) => {
    const bit = it.href ? " " + it.href : "";
    return "[" + it.i + "] <" + it.tag + (it.type ? " type=" + it.type : "") + "> " + (it.text || "") + bit;
  });
  return (page.title || "") + "\n" + (page.url || "") + "\n" + items.join("\n");
}

function onceMessage(ws, id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("cdp-timeout-id-" + id));
    }, 15000);
    function onMsg(ev) {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id !== id) return;
      cleanup();
      if (msg.error) reject(new Error(msg.error.message || "cdp-error"));
      else resolve(msg.result);
    }
    function onErr() {
      cleanup();
      reject(new Error("cdp-ws-error"));
    }
    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMsg);
      ws.removeEventListener("error", onErr);
    }
    ws.addEventListener("message", onMsg);
    ws.addEventListener("error", onErr);
  });
}

export async function withPage(webSocketDebuggerUrl, fn) {
  if (typeof WebSocket !== "function") throw new Error("websocket-missing");
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cdp-ws-open")), { once: true });
  });
  let next = 1;
  async function send(method, params) {
    const id = next++;
    const p = onceMessage(ws, id);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return p;
  }
  try {
    return await fn(send);
  } finally {
    try { ws.close(); } catch {}
  }
}

export async function evaluate(webSocketDebuggerUrl, expression) {
  return withPage(webSocketDebuggerUrl, async (send) => {
    const out = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (out && out.exceptionDetails) {
      const desc = out.exceptionDetails.exception && out.exceptionDetails.exception.description;
      throw new Error(desc || "cdp-evaluate");
    }
    return out && out.result ? out.result.value : null;
  });
}

export async function snapshotPage(webSocketDebuggerUrl) {
  return evaluate(webSocketDebuggerUrl, SNAPSHOT_JS);
}

export async function clickPage(webSocketDebuggerUrl, i) {
  return evaluate(webSocketDebuggerUrl, clickJs(i));
}

export async function typePage(webSocketDebuggerUrl, i, text) {
  return evaluate(webSocketDebuggerUrl, typeJs(i, text));
}

export async function navigatePage(webSocketDebuggerUrl, url) {
  return withPage(webSocketDebuggerUrl, async (send) => {
    await send("Page.enable");
    await send("Page.navigate", { url: String(url) });
    return { ok: true, url: String(url) };
  });
}
