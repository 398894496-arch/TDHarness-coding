import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const EXCLUDE = /ego-lite-linux|CompanyDesk|TDHarness/i;
const PORT = 9222;
let once = null;

function rcExtPathFile() {
  return join(homedir(), ".dsh-company-rc8", "bridge-ext.path");
}

function rememberExt(dir) {
  try {
    const rc = join(homedir(), ".dsh-company-rc8");
    mkdirSync(rc, { recursive: true });
    writeFileSync(rcExtPathFile(), dir.replace(/\\/g, "/") + "\n", "utf8");
  } catch { /* win perms */ }
}

export function findExtensionDir() {
  const rows = [];
  if (process.env.COMPANY_BRIDGE_EXT) rows.push(process.env.COMPANY_BRIDGE_EXT);
  try {
    const listed = readFileSync(rcExtPathFile(), "utf8").replace(/^\uFEFF/, "").trim();
    if (listed) rows.push(listed);
  } catch { /* first run */ }
  const here = dirname(fileURLToPath(import.meta.url));
  rows.push(
    join(here, "..", "..", "browser-extension"),
    join(here, "..", "..", "..", "browser-extension"),
    join(here, "..", "..", "..", "..", "browser-extension"),
    join(here, "..", "..", "..", "..", "..", "browser-extension"),
    join(here, "..", "..", "..", "..", "..", "..", "browser-extension"),
    join(process.cwd(), "browser-extension")
  );
  const hit = rows.find((p) => p && existsSync(join(p, "manifest.json")));
  if (hit) rememberExt(hit);
  return hit;
}

function findChromeBinary() {
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

function dailyUserData(bin) {
  const home = homedir();
  const edge = /msedge|Microsoft Edge/i.test(bin || "");
  if (process.platform === "darwin") {
    return edge
      ? join(home, "Library", "Application Support", "Microsoft Edge")
      : join(home, "Library", "Application Support", "Google", "Chrome");
  }
  const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  return edge
    ? join(local, "Microsoft", "Edge", "User Data")
    : join(local, "Google", "Chrome", "User Data");
}

function processRows() {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(chrome|msedge)\\.exe$' } | ForEach-Object { '{0} {1}' -f $_.ProcessId, $_.CommandLine }"
      ], { encoding: "utf8", timeout: 8000, windowsHide: true });
      return out.split("\n").map((line) => {
        const m = line.trim().match(/^(\d+)\s+(.*)$/);
        if (!m) return null;
        return { pid: Number(m[1]), cmd: m[2] };
      }).filter(Boolean);
    } catch {
      return [];
    }
  }
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

export function isDailyChromeCmd(cmd, bin) {
  if (!cmd) return false;
  const edge = /msedge|Microsoft Edge/i.test(bin || "");
  if (edge) {
    if (!/Microsoft Edge|msedge/i.test(cmd)) return false;
  } else if (!/Google Chrome|Chromium|chrome\.exe/i.test(cmd)) {
    return false;
  }
  if (/Helper|crashpad|gpu-process|renderer|plugin-container|--type=/i.test(cmd)) return false;
  if (EXCLUDE.test(cmd)) return false;
  if (/--user-data-dir/i.test(cmd)) {
    const data = dailyUserData(bin).replace(/\\/g, "/");
    return data.length > 0 && cmd.replace(/\\/g, "/").includes(data);
  }
  return true;
}

function dailyChromePids(bin) {
  return processRows().filter((row) => isDailyChromeCmd(row.cmd, bin)).map((row) => row.pid);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPid(pid, hard) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), hard ? "/F" : "/T"], {
        stdio: "ignore",
        timeout: 8000
      });
    } catch { /* already gone */ }
    return;
  }
  try { process.kill(pid, hard ? "SIGKILL" : "SIGTERM"); } catch { /* already gone */ }
}

async function stopDailyChrome(bin) {
  // Do not osascript-quit / taskkill /IM: that ends every Chrome, including
  // ego's --user-data-dir profile. Only the daily User Data tree.
  for (const pid of dailyChromePids(bin)) killPid(pid, false);
  const start = Date.now();
  while (Date.now() - start < 12000) {
    if (dailyChromePids(bin).length === 0) return;
    await sleep(300);
  }
  for (const pid of dailyChromePids(bin)) killPid(pid, true);
  await sleep(800);
}

async function probe(port) {
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

function launchDaily(bin, extDir) {
  const data = dailyUserData(bin);
  const args = [
    "--remote-debugging-port=" + PORT,
    "--remote-allow-origins=*",
    "--enable-unsafe-extension-debugging",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--load-extension=" + extDir,
    "--user-data-dir=" + data,
    "--profile-directory=Default",
    "--restore-last-session",
    "--no-first-run",
    "--no-default-browser-check"
  ];
  const child = spawn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();
}

async function cdpLoadUnpacked(extDir) {
  const ver = await probe(PORT);
  const wsUrl = ver && (ver.webSocketDebuggerUrl || ver.websocketDebuggerUrl);
  if (!wsUrl || typeof WebSocket !== "function") return false;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("cdp-ws-open")), { once: true });
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cdp-load-timeout")), 8000);
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({
      id: 1,
      method: "Extensions.loadUnpacked",
      params: { path: extDir }
    }));
  }).finally(() => {
    try { ws.close(); } catch {}
  });
  return !!(result && result.result && result.result.id);
}

export async function ensureDailyExtension() {
  if (once) return once;
  once = (async () => {
    const extDir = findExtensionDir();
    if (!extDir) throw new Error("bridge-extension-missing");
    const bin = findChromeBinary();
    if (!bin) throw new Error("chrome-missing");
    const already = await probe(PORT);
    if (!already) {
      await stopDailyChrome(bin);
      launchDaily(bin, extDir);
      const start = Date.now();
      let up = null;
      while (Date.now() - start < 25000) {
        up = await probe(PORT);
        if (up) break;
        await sleep(300);
      }
      if (!up) throw new Error("chrome-debug-port-down");
    }
    try { await cdpLoadUnpacked(extDir); } catch { /* load-extension flag may already have it */ }
    return { extDir };
  })();
  try {
    return await once;
  } catch (err) {
    once = null;
    throw err;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const ego = chrome + " --user-data-dir=/Users/x/.local/share/ego-lite-linux/profile --remote-debugging-port=55016";
  const daily = chrome;
  const helper = chrome + " --type=renderer";
  if (isDailyChromeCmd(ego, chrome)) throw new Error("selftest-ego-kept");
  if (!isDailyChromeCmd(daily, chrome)) throw new Error("selftest-daily-missed");
  if (isDailyChromeCmd(helper, chrome)) throw new Error("selftest-helper-killed");
  process.stdout.write("ENSURE_CHROME_FILTER_OK=1\n");
}
