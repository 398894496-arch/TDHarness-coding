'use strict';
// 只回答一个名字的 DNS：远程员工经 Tailscale 连进来时，把站点名（如 tdh.local）解析到这台服务器的 tailnet 地址。
// Tailscale 后台把这个名字设成分域 DNS 指向本机；别的名字一律 NXDOMAIN，不做转发。
// 用法：node tailnet-dns.js <站点名> [tailscale.exe 路径]（docs/SERVER.md「Remote use」；证明：scripts/prove-tailnet-dns.js）
const dgram = require('dgram');
const net = require('net');
const { execFileSync } = require('child_process');
const NAME = String(process.argv[2] || 'tdh.local').toLowerCase().replace(/\.$/, '');
const TS = process.argv[3] || 'C:\\Program Files\\Tailscale\\tailscale.exe';
const TTL = 300;

function tsIp() {
  try { return execFileSync(TS, ['ip', '-4'], { encoding: 'utf8', timeout: 8000 }).trim().split(/\s+/)[0] || ''; } catch (e) { return ''; }
}

function qname(buf, off) {
  const labels = [];
  for (let i = 0; i < 64; i++) {
    const len = buf[off];
    if (len === undefined) return null;
    if (len === 0) return { name: labels.join('.').toLowerCase(), end: off + 1 };
    if (len & 0xc0) return null;
    labels.push(buf.toString('latin1', off + 1, off + 1 + len));
    off += 1 + len;
  }
  return null;
}

function answer(q, ip, name) {
  if (name === undefined) name = NAME;
  if (q.length < 12) return null;
  const id = q.readUInt16BE(0);
  const flags = q.readUInt16BE(2);
  if (flags & 0x8000) return null; // a response, not a query
  const qd = q.readUInt16BE(4);
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  if (qd !== 1) { head.writeUInt16BE(0x8000 | (flags & 0x0100) | 0x0400 | 1, 2); return head; } // FORMERR
  const n = qname(q, 12);
  if (!n || n.end + 4 > q.length) return null;
  const qtype = q.readUInt16BE(n.end);
  const question = q.subarray(12, n.end + 4);
  const ours = n.name === name;
  let rcode = ours ? 0 : 3; // NXDOMAIN for anything else
  let an = Buffer.alloc(0);
  if (ours && qtype === 1 && net.isIPv4(ip)) {
    an = Buffer.alloc(16);
    an.writeUInt16BE(0xc00c, 0); an.writeUInt16BE(1, 2); an.writeUInt16BE(1, 4);
    an.writeUInt32BE(TTL, 6); an.writeUInt16BE(4, 10);
    ip.split('.').forEach((p, i) => { an[12 + i] = Number(p); });
  }
  // QR, AA, RD copied, RA
  head.writeUInt16BE(0x8000 | 0x0400 | (flags & 0x0100) | 0x0080 | rcode, 2);
  head.writeUInt16BE(1, 4); head.writeUInt16BE(an.length ? 1 : 0, 6);
  return Buffer.concat([head, question, an]);
}

function start() {
  const ip = tsIp();
  if (!net.isIPv4(ip)) { console.log('TDH_DNS_WAIT no-tailscale-ip'); return setTimeout(start, 15000); }
  const udp = dgram.createSocket('udp4');
  udp.on('message', (msg, rinfo) => { const r = answer(msg, ip); if (r) udp.send(r, rinfo.port, rinfo.address); });
  udp.on('error', (e) => { console.log('TDH_DNS_UDP_ERR ' + e.message); try { udp.close(); } catch (x) {} setTimeout(start, 15000); });
  udp.bind(53, ip, () => console.log('TDH_DNS_UP udp ' + ip + ':53 ' + NAME + ' -> ' + ip));
  const tcp = net.createServer((s) => {
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16BE(0)) {
        const len = buf.readUInt16BE(0);
        const r = answer(buf.subarray(2, 2 + len), ip);
        buf = buf.subarray(2 + len);
        if (r) { const l = Buffer.alloc(2); l.writeUInt16BE(r.length, 0); s.write(Buffer.concat([l, r])); }
      }
    });
    s.on('error', () => {});
    s.setTimeout(10000, () => s.destroy());
  });
  tcp.on('error', (e) => console.log('TDH_DNS_TCP_ERR ' + e.message));
  tcp.listen(53, ip);
  // tailnet 地址变了（换网、重新登录）就重启自己，由计划任务拉起
  setInterval(() => { const now = tsIp(); if (now && now !== ip) { console.log('TDH_DNS_IP_CHANGED ' + now); process.exit(3); } }, 60000);
}
if (require.main === module) start();
module.exports = { answer };
