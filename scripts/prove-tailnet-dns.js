#!/usr/bin/env node
// server/tailnet-dns.js 只回答站点名：A 记录给服务器的 tailnet 地址，AAAA 无记录但不报不存在，
// 别的名字 NXDOMAIN，大小写和末尾的点不影响，坏包、应答包、多问题不回或回 FORMERR。打印 TAILNET_DNS_PROVE_OK=1。
'use strict';
const assert = require('assert');
const { answer } = require('../server/tailnet-dns.js');

function query(name, type, id) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id || 0x1234, 0); head.writeUInt16BE(0x0100, 2); head.writeUInt16BE(1, 4);
  const labels = name.split('.').filter(Boolean).map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'latin1')]));
  const tail = Buffer.alloc(4); tail.writeUInt16BE(type, 0); tail.writeUInt16BE(1, 2);
  return Buffer.concat([head, ...labels, Buffer.from([0]), tail]);
}
const rcode = (r) => r.readUInt16BE(2) & 0xf;
const ancount = (r) => r.readUInt16BE(6);
const ip = '100.101.102.103';

let r = answer(query('tdh.local', 1, 0xbeef), ip, 'tdh.local');
assert.strictEqual(r.readUInt16BE(0), 0xbeef, 'id echoed');
assert.ok(r.readUInt16BE(2) & 0x8000, 'is a response');
assert.ok(r.readUInt16BE(2) & 0x0400, 'authoritative');
assert.strictEqual(rcode(r), 0);
assert.strictEqual(ancount(r), 1);
assert.deepStrictEqual([...r.subarray(r.length - 4)], [100, 101, 102, 103], 'A record is the tailnet address');
assert.strictEqual(r.readUInt32BE(r.length - 10), 300, 'ttl');

r = answer(query('TDH.Local', 1), ip, 'tdh.local');
assert.strictEqual(ancount(r), 1, 'case-insensitive');
r = answer(query('tdh.local', 28), ip, 'tdh.local');
assert.ok(rcode(r) === 0 && ancount(r) === 0, 'AAAA: no record, not NXDOMAIN');
for (const other of ['example.com', 'x.tdh.local', 'tdh.local.evil', 'printer.local']) {
  r = answer(query(other, 1), ip, 'tdh.local');
  assert.ok(rcode(r) === 3 && ancount(r) === 0, 'NXDOMAIN for ' + other);
}
assert.strictEqual(answer(Buffer.alloc(5), ip, 'tdh.local'), null, 'short packet ignored');
const resp = query('tdh.local', 1); resp.writeUInt16BE(0x8100, 2);
assert.strictEqual(answer(resp, ip, 'tdh.local'), null, 'a response is not answered');
const two = query('tdh.local', 1); two.writeUInt16BE(2, 4);
assert.strictEqual(rcode(answer(two, ip, 'tdh.local')), 1, 'two questions: FORMERR');
const ptr = query('tdh.local', 1); ptr[12] = 0xc0;
assert.strictEqual(answer(ptr, ip, 'tdh.local'), null, 'compressed question name ignored');
r = answer(query('tdh.local', 1), 'not-an-ip', 'tdh.local');
assert.ok(rcode(r) === 0 && ancount(r) === 0, 'no address yet: no record');
console.log('TAILNET_DNS_PROVE_OK=1');
