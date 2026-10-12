// Pin login personal/org like Win AppHost.PinWorkspaces.
// Env: PIN_PERSONAL, PIN_ORG, PIN_PORT. Do not pass paths as node - argv
// (node - eats argv[1], and a path then looks like a port).
"use strict";

const http = require("http");
const crypto = require("crypto");

const personal = String(process.env.PIN_PERSONAL || "").trim();
const org = String(process.env.PIN_ORG || "").trim();
const port = Number(process.env.PIN_PORT || 17803);

function rpc(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      type: "client-request",
      rpcId: crypto.randomUUID(),
      method,
      payload,
    });
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/" + method,
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => {
          d += c;
        });
        res.on("end", () => resolve(d));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function field(raw, key) {
  const m = String(raw).match(new RegExp('"' + key + '"\\s*:\\s*"([^"]+)"'));
  return m ? m[1] : "";
}

(async () => {
  if (!personal) throw new Error("pin-personal-missing");
  if (!(port > 0 && port < 65536)) throw new Error("pin-port-bad");
  const a = await rpc("workspace.create", { path: personal });
  const id = field(a, "workspaceId");
  if (id) await rpc("workspace.rename", { workspaceId: id, title: "个人" });
  if (org && org !== personal) {
    const b = await rpc("workspace.create", { path: org });
    const id2 = field(b, "workspaceId");
    if (id2) await rpc("workspace.rename", { workspaceId: id2, title: "团队" });
  }
  console.log("PIN_OK=1");
})().catch((e) => {
  console.error("PIN_FAIL=" + e.message);
  process.exitCode = 0;
});
