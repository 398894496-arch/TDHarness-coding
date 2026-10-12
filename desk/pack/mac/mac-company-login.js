#!/usr/bin/env node
// Roster POST like Win AppHost. IPv4 only. Bundled node. No python3 / CLT.
"use strict";

const dns = require("dns");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { URL } = require("url");

function macWork(winPath) {
  const pth = String(winPath || "").replace(/\\/g, "/").trim();
  const key = "dsh/company";
  const i = pth.toLowerCase().indexOf(key);
  if (i < 0) return "";
  const rel = pth.slice(i + key.length).replace(/^\/+/, "");
  const root = path.join(os.homedir(), "company");
  return rel ? path.join(root, rel) : root;
}

function write(dest, text, mode) {
  fs.writeFileSync(dest, text, { encoding: "utf8" });
  if (mode) fs.chmodSync(dest, mode);
}

function fail(msg) {
  process.stderr.write(String(msg) + "\n");
  process.exit(2);
}

const urlRaw = process.env.LOGIN_URL;
const user = process.env.LOGIN_USER;
const pw = process.env.LOGIN_PASS;
const tokPath = process.env.TOKFILE;
if (!urlRaw || !user || !pw || !tokPath) fail("login-env-missing");

let u;
try {
  u = new URL(urlRaw);
} catch {
  fail("login-url-bad");
}
const body = JSON.stringify({ username: user, password: pw });
const port = Number(u.port || 443);

dns.lookup(u.hostname, { family: 4 }, (err, addr) => {
  if (err) fail(err);
  const req = https.request(
    {
      hostname: addr,
      port,
      path: u.pathname || "/company/login",
      method: "POST",
      servername: u.hostname,
      headers: {
        Host: u.host,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Connection: "close",
      },
      rejectUnauthorized: false,
      timeout: 20000,
    },
    (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 400) fail("login-http:" + res.statusCode);
        let hit;
        try {
          hit = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          fail("login-json");
        }
        if (!hit || !hit.ok || !hit.gw_token) {
          fail("login-" + String((hit && hit.error) || "no-token"));
        }
        const rc8 = path.dirname(tokPath);
        fs.mkdirSync(rc8, { recursive: true });
        write(tokPath, String(hit.gw_token).trim() + "\n", 0o600);
        if (hit.smb_user && hit.smb_pass) {
          write(path.join(rc8, "smb.user"), String(hit.smb_user).trim() + "\n");
          write(path.join(rc8, "smb.pass"), String(hit.smb_pass).trim() + "\n", 0o600);
        }
        const pers = macWork(hit.personal);
        const org = macWork(hit.org);
        if (pers) write(path.join(rc8, "work.personal"), pers + "\n");
        if (org) write(path.join(rc8, "work.org"), org + "\n");
        if (hit.role) write(path.join(rc8, "login.role"), String(hit.role).trim() + "\n");
        if (hit.login) write(path.join(rc8, "login.name"), String(hit.login).trim() + "\n");
        process.stdout.write("LOGIN_OK=" + String(hit.login || "") + "\n");
      });
    }
  );
  req.on("timeout", () => {
    req.destroy();
    fail("login-timeout");
  });
  req.on("error", (e) => fail(e && e.message ? e.message : e));
  req.write(body);
  req.end();
});
