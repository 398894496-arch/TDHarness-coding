---
name: company-dept
description: Stay inside the assigned department share.
whenToUse: 个人盘, 部门盘, workspace chip.
disable-model-invocation: true
---

# company-dept

每个登录只有两根指针：个人可写，部门只读。项目不是工作区。

## 谁看见哪棵树

| 角色 | 个人 | 部门 / 公司 |
|---|---|---|
| 员工 | `D:/dsh/company/<dept>/emp-<id>/` | 本部门根，只读 |
| 总监 | `D:/dsh/company/<dept>/<login>/` | 本部门根 |
| 老板 | `D:/dsh/company/_office/` | `D:/dsh/company` |

跨部门路径一律拒绝，包括绝对路径。`_control` 和控制面脚本以外的人无关。`_skills` 只读。

花名册在 `people/roster.json`。目录由 `company_disk.py plant` 生成，不要 `mkdir` 漏斗层。
