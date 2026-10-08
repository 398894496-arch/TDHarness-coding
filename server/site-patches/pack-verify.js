#!/usr/bin/env node
// 一键更新的下载校验：解压前确认 zip 是服务器签过名的那一份。
// 服务器出包时把每个 zip 的 sha256 写进 version.json，并用只在服务器上的 Ed25519 私钥
// 对 version.json 原文签名（version.sig）。这里用随包下发的 pack-sign.pub 验签，再核对 zip 的哈希。
// 8443 或它的证书被换掉时，对方拿不到私钥，签不出能过这里的 version.json。
// 用法：node pack-verify.js --root DIR --zip FILE --url ZIP_URL --platform win|mac
// 退出码：0 通过或本机还没有公钥（旧装机的过渡期）；3 校验失败，调用方必须放弃安装。
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

function out(s) {
  process.stdout.write(s + "\n");
}

function fail(reason) {
  out("PACK_VERIFY_FAIL=" + reason);
  process.exit(3);
}

function args(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--") && i + 1 < argv.length) a[k.slice(2)] = argv[++i];
  }
  return a;
}

// 证书校验关着没关系：信任来自签名，不来自 TLS。
function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { rejectUnauthorized: false, timeout: 20000, headers: { "cache-control": "no-store" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function sha256File(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

async function main() {
  const a = args(process.argv);
  const root = path.resolve(a.root || path.dirname(process.argv[1]));
  const pubPath = path.join(root, "pack-sign.pub");
  if (!fs.existsSync(pubPath)) {
    out("PACK_VERIFY=skip-no-key");
    return;
  }
  if (!a.zip || !fs.existsSync(a.zip)) fail("zip-missing");
  if (!a.url) fail("url-missing");
  const platform = a.platform === "mac" ? "mac" : "win";

  let base;
  try {
    const u = new URL(a.url);
    u.search = "";
    u.hash = "";
    base = u.href.replace(/[^/]*$/, "");
  } catch {
    fail("url-bad");
  }

  let ver;
  let sig;
  try {
    ver = await get(base + "version.json");
    sig = await get(base + "version.sig");
  } catch (e) {
    fail("fetch-" + String((e && e.message) || e).slice(0, 40));
  }
  if (ver.status !== 200) fail("version-http-" + ver.status);
  if (sig.status !== 200) fail("sig-http-" + sig.status);

  let ok = false;
  try {
    const pub = crypto.createPublicKey(fs.readFileSync(pubPath, "utf8"));
    ok = crypto.verify(null, ver.body, pub, Buffer.from(sig.body.toString("utf8").trim(), "base64"));
  } catch (e) {
    fail("sig-error-" + String((e && e.message) || e).slice(0, 40));
  }
  if (!ok) fail("sig-mismatch");

  let doc;
  try {
    doc = JSON.parse(ver.body.toString("utf8"));
  } catch {
    fail("version-unparseable");
  }
  const row = doc && doc[platform];
  if (!row || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)) fail("version-no-sha256");
  const urlFile = decodeURIComponent(new URL(a.url).pathname.split("/").pop() || "");
  if (row.file && urlFile && row.file !== urlFile) fail("file-name-mismatch");
  const got = sha256File(a.zip);
  if (got !== row.sha256) fail("zip-sha256-mismatch");
  out("PACK_VERIFY_OK=1");
  out("PACK_VERIFY_SHA256=" + got.slice(0, 16));
}

main().catch((e) => fail("crash-" + String((e && e.message) || e).slice(0, 40)));
