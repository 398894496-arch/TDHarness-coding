# 寻找共建者

项目讲解（单独一页，按对外说明书）：[BRIEF.zh.md](BRIEF.zh.md)。本页仍是认领缺口，不替代英文 [BUGS.md](../BUGS.md)。

这是英文仓的**中文增页**，不替代 [README](../README.md) / [BUGS.md](../BUGS.md) / [CONTRIBUTING.md](../CONTRIBUTING.md)。工单标题、补丁标记、CI 绿线仍以英文原文为准。

功能长什么样（带截图）：[BRIEF.zh.md](BRIEF.zh.md)。

定位：DeepSeek Harness 上的 **coding 补丁树**。能用，不是成熟产品。本地文件夹 + 你自己的模型 key。不是员工安装包，不是托管 SaaS。官方上游暂时不收外部 PR。产品向的 PR 只在**本仓**合。

## 参与门槛

不需要公司网、花名册、协作者权限。

1. 按 [README](../README.md) 在**本地目录**装一遍。setup 或第一次 `dsh --patch` 挂了，开 **Bug** 就有用。
2. 从下面认领一个 id，开 **Task** issue（标题带 `C1`…`C8`），再 fork + PR。
3. 验收看 `*_OK=1`，不看「我改了 README」。

技术细节、文件路径、Done when 写在英文 [BUGS.md](../BUGS.md)。

## 现在缺什么

| Id | 缺什么 | 大概要谁 |
| --- | --- | --- |
| C1 | 沙箱路径检查没有行为测试，现在只 grep 补丁标记 | 会 Node 即可，不必 Windows |
| C2 | 映射盘 / SUBST 仍被当成本地盘，会去种 NTFS ACL | 要一台能映射盘或 SUBST 的 Windows |
| C3 | 审 `trustedHost`（自定义 skill 目录）和 DACL 在 ACCESS_DENIED 时跳过 | Windows ACL + dsh 沙箱 |
| C4 | `setup` 仍把公司 `__DESK_SKILLS__` 打进官方 `standard`/`code` 预设 | 会看 `--dump-config` |
| C5 | 没有脚本对下一个 `dsh` 标签试打补丁，看哪条锚点裂 | npm 前缀 |
| C6 | 扫描只认办公室指纹，认不出新格式的 key | CI / secret scan |
| C7 | Windows `mklink` 没有真跑，只在源码里搜字符串 | Windows |
| C8 | 搜索根缺失变成「无匹配」，可能把真 IO 错误吞掉 | 会 rg |

不是缺口：本地工作区（网络盘当沙箱根是故意拒绝的）；往官方仓提 PR。

## 怎么算做完

绿线写在 [BUGS.md](../BUGS.md) 对应 C# 的 **Done when**。路径和脚本名只用 ASCII。不要提交办公室 IP、密码、花名册、活的 `node_modules`。
