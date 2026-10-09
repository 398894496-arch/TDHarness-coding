#!/usr/bin/env node
// 服务器端：一键更新包的签名。私钥只在本机，公钥随客户端包下发（pack-sign.pub）。
//   node pack-sign.js keygen  [--dir D:\dsh\runtime\pack-sign]   只建一次；已存在就拒绝覆盖
//   node pack-sign.js pub     [--dir ...]                         打印公钥 PEM
//   node pack-sign.js sign    --dist D:\dsh\client-dist [--dir ...]
//        给 version.json 里每个包补 sha256，写回原文后对原文签名 -> version.sig
// 换私钥 = 所有已装客户端的下一次更新都会被拒，只能重装。不要重复 keygen。
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function out(s) {
  process.stdout.write(s + "\n");
}

function args(argv) {
  const a = { _: argv[2] || "" };
  for (let i = 3; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith("--") && i + 1 < argv.length) a[k.slice(2)] = argv[++i];
  }
  return a;
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

const a = args(process.argv);
const dir = path.resolve(a.dir || "D:\\dsh\\runtime\\pack-sign");
const keyPath = path.join(dir, "pack-sign.key");
const pubPath = path.join(dir, "pack-sign.pub");

if (a._ === "keygen") {
  if (fs.existsSync(keyPath)) {
    out("BLOCKED=key-exists:" + keyPath);
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  fs.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  fs.writeFileSync(pubPath, publicKey.export({ type: "spki", format: "pem" }));
  out("PACK_SIGN_KEY_CREATED=" + keyPath);
  process.exit(0);
}

if (a._ === "pub") {
  process.stdout.write(fs.readFileSync(pubPath, "utf8"));
  process.exit(0);
}

if (a._ === "sign") {
  if (!a.dist) {
    out("BLOCKED=need --dist");
    process.exit(2);
  }
  const dist = path.resolve(a.dist);
  const verPath = path.join(dist, "version.json");
  const doc = JSON.parse(fs.readFileSync(verPath, "utf8").replace(/^\uFEFF/, ""));
  for (const plat of ["win", "mac"]) {
    const row = doc[plat];
    if (!row || !row.file) continue;
    const zip = path.join(dist, row.file);
    if (!fs.existsSync(zip)) continue;
    row.bytes = fs.statSync(zip).size;
    row.sha256 = sha256File(zip);
    out("SHA256_" + plat.toUpperCase() + "=" + row.sha256.slice(0, 16));
    // Delta packs (pack-delta.py build) are signed with the same version.json.
    for (const from of Object.keys(row.deltas || {})) {
      const d = row.deltas[from];
      const dp = d && typeof d.file === "string" && !/\.\./.test(d.file) ? path.join(dist, d.file) : "";
      if (!dp || !fs.existsSync(dp)) { delete row.deltas[from]; continue; }
      d.bytes = fs.statSync(dp).size;
      d.sha256 = sha256File(dp);
      out("DELTA_SHA256_" + plat.toUpperCase() + "_" + from.slice(0, 8) + "=" + d.sha256.slice(0, 16));
    }
  }
  const body = Buffer.from(JSON.stringify(doc) + "\n", "utf8");
  const key = crypto.createPrivateKey(fs.readFileSync(keyPath, "utf8"));
  const sig = crypto.sign(null, body, key).toString("base64");
  // 先写 sig 再写 json 会有一瞬间不匹配；反过来也一样。客户端失败只是这次不装，下次再试。
  fs.writeFileSync(verPath + ".tmp", body);
  fs.writeFileSync(path.join(dist, "version.sig.tmp"), sig + "\n");
  fs.renameSync(verPath + ".tmp", verPath);
  fs.renameSync(path.join(dist, "version.sig.tmp"), path.join(dist, "version.sig"));
  const pub = crypto.createPublicKey(fs.readFileSync(pubPath, "utf8"));
  if (!crypto.verify(null, fs.readFileSync(verPath), pub, Buffer.from(fs.readFileSync(path.join(dist, "version.sig"), "utf8").trim(), "base64"))) {
    out("BLOCKED=self-verify-failed");
    process.exit(3);
  }
  out("PACK_SIGN_OK=1");
  process.exit(0);
}

out("usage: pack-sign.js keygen|pub|sign --dist DIR [--dir KEYDIR]");
process.exit(2);
