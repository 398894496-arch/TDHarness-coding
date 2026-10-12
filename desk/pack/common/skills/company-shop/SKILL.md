---
name: company-shop
description: Own-shop drafts from files the owner dropped. Never cookies.
whenToUse: 推广, 客服, 店铺导出.
disable-model-invocation: true
---

# company-shop

只帮**这把椅子自己的店**。数据只来自公司盘 `_office/shop` 里店主自己丢进来的文件。

## 店主怎么用（不会电脑也行）

1. 千牛里点导出。
2. 推广 csv 丢进 `_office/shop`，客服/售后丢进 `_office/shop/service/inbox`。
3. 跟会话说「看推广」「帮我看客服」或「收进知识库」。

过往全部：店主在千牛按月导出，丢进来后 `shop_ingest`。不能从千牛一次拉完。

## 工具

- 入库：`mcp__shop__shop_ingest` → `_office/_memory/03-evidence`，原件 `shop/archive`
- 推广：`shop_watch` → 必要时 `shop_digest` → 店主点头才 `shop_plan_adjust`
- 客服忙：`shop_service` → `shop_draft` 出草稿，人贴回千牛
- 口径：`shop_faq`

## 不要做

- 不要搞 cookie，不要读 QianniuTemp
- 不要 `ego_*` / `browser_*` / `web_fetch` 打开生意参谋、千牛、旺旺去爬
- 不要代发旺旺。草稿要人看过
- 没有新导出就不要改推广计划
