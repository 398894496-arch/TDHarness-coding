import { existsSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";

const PORT = 9222;
const EXCLUDE = /ego-lite-linux|CompanyDesk|TDHarness/i;

export function dailyPort() {
  return Number(process.env.COMPANY_OPEN_BROWSER_PORT || PORT);
}

export async function probe(port = dailyPort()) {
  try {
    const r = await fetch("http://127.0.0.1:" + port + "/json/version", {
      signal: AbortSignal.timeout(800)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function listPages(port = dailyPort()) {
  const r = await fetch("http://127.0.0.1:" + port + "/json/list", {
    signal: AbortSignal.timeout(2000)
  });
  if (!r.ok) throw new Error("cdp-list-" + r.status);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).filter((t) => {
    if (t.type !== "page") return false;
    const url = String(t.url || "");
    return !url.startsWith("chrome://") && !url.startsWith("edge://") && !url.startsWith("devtools://");
  });
}

export function findChromeBinary() {
  if (process.env.COMPANY_OPEN_BROWSER_BIN) return process.env.COMPANY_OPEN_BROWSER_BIN;
  if (process.platform === "darwin") {
    const rows = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    ];
    return rows.find((p) => existsSync(p));
  }
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pfx86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || "";
  const rows = [
    pf + "\\Google\\Chrome\\Application\\chrome.exe",
    local + "\\Google\\Chrome\\Application\\chrome.exe",
    pf + "\\Microsoft\\Edge\\Application\\msedge.exe",
    pfx86 + "\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  return rows.find((p) => existsSync(p));
}

function processRows() {
  try {
    const out = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
      encoding: "utf8",
      timeout: 4000
    });
    return out.split("\n").map((line) => {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) return null;
      return { pid: Number(m[1]), cmd: m[2] };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function dailyChromePids() {
  if (process.platform === "win32") return [];
  return processRows().filter((row) => {
    if (!/Google Chrome|Microsoft Edge|Chromium/i.test(row.cmd)) return false;
    if (/Helper|crashpad|gpu-process|renderer|plugin-container/i.test(row.cmd)) return false;
    if (EXCLUDE.test(row.cmd)) return false;
    return true;
  }).map((row) => row.pid);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopDailyChrome() {
  if (process.platform === "win32") {
    for (const name of ["chrome.exe", "msedge.exe"]) {
      try {
        execFileSync("taskkill", ["/IM", name, "/F"], { stdio: "ignore", timeout: 8000 });
      } catch {}
    }
    await sleep(1200);
    return;
  }
  for (const pid of dailyChromePids()) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  const start = Date.now();
  while (Date.now() - start < 8000) {
    if (dailyChromePids().length === 0) break;
    await sleep(250);
  }
}

function launchDaily(bin, port) {
  const args = [
    "--remote-debugging-port=" + port,
    "--remote-allow-origins=*",
    "--restore-last-session",
    "--no-first-run",
    "--no-default-browser-check"
  ];
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function ensureDailyCdp() {
  const port = dailyPort();
  const already = await probe(port);
  if (already) {
    return { port, relaunched: false, browser: already.Browser || already.browser || "chrome" };
  }
  const bin = findChromeBinary();
  if (!bin) throw new Error("chrome-missing: install Chrome or Edge on this machine");
  await stopDailyChrome();
  launchDaily(bin, port);
  const start = Date.now();
  while (Date.now() - start < 20000) {
    const v = await probe(port);
    if (v) {
      return { port, relaunched: true, browser: v.Browser || v.browser || "chrome" };
    }
    await sleep(300);
  }
  throw new Error("cdp-timeout: Chrome did not open debug port " + port);
}
