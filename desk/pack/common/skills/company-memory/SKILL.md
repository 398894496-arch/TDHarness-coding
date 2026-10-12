---
name: company-memory
description: Write company-disk memory. Load only when writing.
whenToUse: 记住, 写入记忆.
disable-model-invocation: true
---

# company-memory

TDHarness 的永久记忆在公司盘上，不在本机 `memory`，也不在任何人自己电脑上的笔记软件里。

每人一套，分层存放（见下表）。另外有一块全员可搜的共享区。

| 区 | 路径 | 谁写 | 谁搜 |
|---|---|---|---|
| 个人 | `$personal/_memory/` | 只有这把椅子 | 只有这把椅子（检索门按登录收） |
| 共享 | 共享盘根 `_shared/_memory/` | 老板 / 总监，或过晋升门 | 全员 |

不要读个人 vault。不要对别人的 `_memory` 做 `rg`。检索走同一扇门。

## 分层（个人和共享同一套）

- `01-projects` 正在推进
- `02-methods` 验证过、下次还能用
- `03-evidence` 原文和证据
- `04-reviews` 做完了怎么评价
- `05-logs` 当天发生了什么（不自动等于结果）
- `90-system/corrections.md` 纠错；最新的压过旧的
- `_index.md` 入口

高可信才能当行动依据。没来源、新闻、猜测，先核再写。

## 开场

查公司事实用 `company-knowledge`，不要为本技能再搜一遍。写入才加载本包。收据能闭合就停。不要 curl 8443，不要自己报账号。

查找用 `route=search`（已含个人 `_memory` + 共享 `_memory` + 查阅层）。不要再分旧 route。

## 写入

用户确认、纠错、或验收过的做法，马上写入，不要等日更。不要用官方 `write` 打 `_shared`：个人会话沙箱根是 `_office`，官方 `write` 出不去；公司盘 SMB 上官方原子 rename 还会 `ENOTSUP`。

用宿主工具 **`company_memory_write`**：

```
company_memory_write  zone=personal|shared  layer=01-projects|02-methods|03-evidence|04-reviews|05-logs|90-system  name=<ascii-slug>  content=<markdown>  mode=replace|append
```

- 个人区：`zone=personal`（老板是 `_office/_memory`）
- 共享区：`zone=shared`，只有 `login.role=admin` 或 `director`。员工调会被拒
- 方法 → `02-methods/<ascii-slug>`
- 证据 → `03-evidence`
- 当天流水 → `05-logs/<yyyy-mm-dd>`，`mode=append`
- 纠错 → `90-system` + `name=corrections`，`mode=append`

frontmatter 最少：`status` `confidence` `source_ref` `verified_at`。正文写适用条件和限制。工具在缺 frontmatter 时会补一截。

晋升进共享：已解决真问题、有来源或用户确认、以后还能用、能说清限制。员工不要自己写 `_shared`。要全员用，交给老板 / 总监用 `company_memory_write zone=shared`，或等晋升作业。

## 不要做

- 不要把个人记忆写进 `_skills`、handbook、别人的格子
- 不要找本机 `memory` / `memory_recall`（这台桌没有）。不要把 `.dsh-desk` 对话当永久记忆
- 不要把谁本机的笔记库当员工记忆
- 不要一次总结就写成全公司真理
