#!/usr/bin/env node
// How well the knowledge search answers, as numbers: a made-up company handbook (12 pages),
// 26 questions that have an answer in it, 12 that do not, and one that needs the company's
// synonym list. Method after DSH-KRouter: the right page first or in the top three, and an
// off-topic question must get nothing rather than a guess (on the desk, "nothing" lets the
// agent fall back to web search; a weak hit stops it there).
//   node scripts/prove-kb-recall.js          prints the score; fails under the floors below
//   KB_RECALL_VERBOSE=1 node ...             prints every question and what it got
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createIndex } = require('../server/kb-index');

const FLOOR = { top1: 0.8, top3: 0.95, refuse: 0.9 };

const PAGES = {
  '报销制度.md': `# 报销制度
差旅报销：出差住宿每晚上限 400 元，一线城市 500 元。交通按实际票据报销，高铁二等座、飞机经济舱。
发票抬头写公司全称「示例科技有限公司」，税号在财务群公告里。
报销在费用发生后 30 天内提交，走飞书审批，部门负责人批完财务再审。
餐补每天 60 元，不需要发票。`,
  '售后与退货.md': `# 售后与退货
客户签收后七天无理由退货，商品不影响二次销售即可。
退货运费：质量问题由公司承担，非质量问题由客户承担。
质量问题优先换货，换货寄回地址：杭州市余杭区仓库三号门。
客服在 24 小时内回复售后工单。`,
  '请假与考勤.md': `# 请假与考勤
上班打卡时间 9:00，下班 18:00，弹性半小时。
迟到 30 分钟以内每次扣 50 元，超过按半天事假算。
年假：入职满一年 5 天，满三年 10 天。
病假需要医院证明，连续三天以上要病历。`,
  '入职指南.md': `# 入职指南
新员工第一周：开通企业邮箱和飞书账号，领取电脑，和导师一起熟悉业务。
电脑在行政处领取，签收单交给行政。
试用期三个月，转正需要导师评价和部门负责人面谈。`,
  '仓库操作.md': `# 仓库操作
入库流程：核对送货单，扫码入库，异常拍照。
每月最后一天全仓盘点，盘点差异当天报给主管。
货物破损登记：在破损登记表写单号、数量、原因，拍照上传。`,
  '抖音运营.md': `# 抖音运营
直播排期：每周二、四、六晚上 8 点开播，每场三小时。
投流预算每天 3000 元，ROI 低于 2 暂停投放。
选品看近 30 天销量和退货率。`,
  '报价规则.md': `# 报价规则
标准单价见价目表。大客户（年采购超过 50 万）打九折。
起订量 1000 件，低于起订量加收 10% 小单费。
报价单有效期 15 天。`,
  '信息安全.md': `# 信息安全
密码至少 12 位，包含大小写字母和数字，每 90 天更换。
客户数据不得外发，不得上传到个人网盘或发给公司以外的人。
远程办公必须连 VPN。`,
  '设计规范.md': `# 设计规范
品牌主色 #FF6A00，辅助色深灰 #333333。
字体用思源黑体。
海报尺寸 1080x1920，横版 1920x1080。`,
  '采购流程.md': `# 采购流程
采购前三家比价，比价单留档。
单笔超过 5000 元需要老板审批，5000 元以下部门负责人批。
供应商首次合作要签保密协议。`,
  '发货流程.md': `# 发货流程
下午 4 点前下单当天发货，之后的第二天发。
默认顺丰，偏远地区用邮政，运费按区域表。
发货后在系统里填快递单号。`,
  '会议制度.md': `# 会议制度
每周一上午 10 点部门例会，每次不超过一小时。
会议纪要在会后 24 小时内发到群里，写清负责人和截止时间。`,
};

const HITS = [
  ['出差住宿一晚能报多少', '报销制度.md'],
  ['发票抬头写什么', '报销制度.md'],
  ['报销要在多久内提交', '报销制度.md'],
  ['七天无理由退货', '售后与退货.md'],
  ['退货运费谁出', '售后与退货.md'],
  ['年假有几天', '请假与考勤.md'],
  ['几点打卡', '请假与考勤.md'],
  ['迟到怎么扣钱', '请假与考勤.md'],
  ['新员工第一周做什么', '入职指南.md'],
  ['电脑在哪领', '入职指南.md'],
  ['每个月哪天盘点', '仓库操作.md'],
  ['货物破损怎么登记', '仓库操作.md'],
  ['直播排期', '抖音运营.md'],
  ['投流预算多少', '抖音运营.md'],
  ['大客户打几折', '报价规则.md'],
  ['起订量是多少', '报价规则.md'],
  ['密码要几位', '信息安全.md'],
  ['能不能把客户数据发给别人', '信息安全.md'],
  ['海报尺寸', '设计规范.md'],
  ['品牌主色是什么', '设计规范.md'],
  ['采购要比价吗', '采购流程.md'],
  ['多少钱以上要老板批', '采购流程.md'],
  ['几点前下单当天发货', '发货流程.md'],
  ['周一例会几点', '会议制度.md'],
  ['会议纪要什么时候发', '会议制度.md'],
  ['VPN', '信息安全.md'],
];

const NONE = [
  '咖啡机除垢周期是多少',
  '房贷利率怎么算',
  'Kubernetes 集群怎么升级',
  '公司年会在哪里办',
  '怎么申请专利',
  '社保基数是多少',
  '股票期权怎么行权',
  '食堂今天吃什么',
  '停车位怎么申请',
  '小程序上线审核要多久',
  '外贸报关流程',
  '新冠疫苗在哪打',
];

// A word the handbook never uses: found only once the company says it means 报销.
const SYNONYM = ['核销流程', '报销制度.md', '# 公司自己的说法\n报销 = 核销, 报账\n'];

function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdh-recall-'));
  const hb = path.join(dir, '_handbook', '_company');
  fs.mkdirSync(hb, { recursive: true });
  for (const [name, text] of Object.entries(PAGES)) fs.writeFileSync(path.join(hb, name), text + '\n');
  const verbose = !!process.env.KB_RECALL_VERBOSE;
  const run = (idx, q, opts) => idx.search([hb], [q], { limit: 5, perFile: 1, ...(opts || {}) });
  try {
    const idx = createIndex();
    let top1 = 0;
    let top3 = 0;
    for (const [q, want] of HITS) {
      const got = run(idx, q).map((h) => path.basename(h.full));
      if (got[0] === want) top1++;
      if (got.slice(0, 3).includes(want)) top3++;
      if (verbose || !got.slice(0, 3).includes(want)) console.log((got[0] === want ? 'ok   ' : got.includes(want) ? 'low  ' : 'MISS ') + q + ' -> ' + (got.join(', ') || '(none)'));
    }
    let refused = 0;
    for (const q of NONE) {
      const got = run(idx, q);
      if (!got.length) refused++;
      if (verbose || got.length) console.log((got.length ? 'GUESS ' : 'none  ') + q + (got.length ? ' -> ' + got.map((h) => path.basename(h.full)).join(', ') : ''));
    }
    // Synonym: without the list it is not found; with it, it is.
    const [sq, swant, slist] = SYNONYM;
    const before = run(idx, sq).map((h) => path.basename(h.full));
    fs.writeFileSync(path.join(hb, '同义词.txt'), slist);
    const idx2 = createIndex();
    const after = run(idx2, sq, { synonyms: idx2.synonyms ? idx2.synonyms([hb]) : [] }).map((h) => path.basename(h.full));
    const synOk = !before.includes(swant) && after[0] === swant;
    if (verbose || !synOk) console.log('synonym ' + sq + ': before ' + (before.join(', ') || '(none)') + ' / after ' + (after.join(', ') || '(none)'));

    const score = { top1: top1 / HITS.length, top3: top3 / HITS.length, refuse: refused / NONE.length };
    console.log('KB_RECALL top1=' + top1 + '/' + HITS.length + ' top3=' + top3 + '/' + HITS.length + ' refused=' + refused + '/' + NONE.length + ' synonym=' + (synOk ? 'ok' : 'FAIL'));
    const bad = Object.keys(FLOOR).filter((k) => score[k] < FLOOR[k]);
    if (bad.length || !synOk) {
      console.error('KB_RECALL_FAIL below ' + bad.map((k) => k + '<' + FLOOR[k]).join(' ') + (synOk ? '' : ' synonym'));
      process.exit(1);
    }
    console.log('KB_RECALL_OK=1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
