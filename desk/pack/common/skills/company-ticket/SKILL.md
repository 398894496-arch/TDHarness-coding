---
name: company-ticket
description: Company task cards on the shared disk.
whenToUse: 上传下达, 任务卡, 做完了, 验收.
disable-model-invocation: true
---

# company-ticket

任务卡的文件落在公司盘，不落 `DSH_HOME`，界面不写盘。格子读 `/company/mailbox`。对话里的「做完了」不是验收。

## 谁能下达

| 角色 | 能 issue 给谁 |
|---|---|
| 老板 | 任意员工 |
| 总监 | 本部门员工 |
| 员工 | **只能给自己**（自己给自己开一张待提交） |

员工不能给别人下达。员工侧栏「+」就是给自己 issue。employee can issue only to self.

## 路径（ASCII）

根：共享盘根（Win `D:/dsh/company`，Mac `$HOME/company`）。本机探针树禁止。

- 下达：`<dept>/emp-<id>/inbox/<ticket-id>/`
- 上传：`<dept>/emp-<id>/projects/<project-id>/`，副本在 `<dept>/_outbox/<ticket-id>/`
- 控制面副本：`_control/tickets/<ticket-id>/`
- 指针：`_control/mailbox/board.json`

## 员工桌上怎么用

这台桌**没有** `mailbox` 工具，也不要跑仓库工单脚本，不要 curl / POST 8443。

- 等人从侧栏「任务」下达。`inbox` 空着是还没人给这把椅子派活。
- 要给自己开卡：侧栏任务页的「+」。
- 做完：侧栏「提交验收」。只说「做完了」不算。

## 验收

- 绿/红只听控制面 `submit` 之后的状态（待审批 / 已通过 / 未通过）。
- 界面「提交验收」才会改 board。
- 不要把完成权写进对话。用户或模型说「做完了」而不点提交、不跑 submit，格子仍是待提交。

## 禁区

- 不要把别人部门的绝对路径当工作区。
- 不要改 `_control`、`_skills`、别人的 `emp-*`。
