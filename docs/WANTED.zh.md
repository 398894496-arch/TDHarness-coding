# 寻找共建者

这是英文仓的**中文增页**，不替代 [README](../README.md) / [BUGS.md](../BUGS.md) / [CONTRIBUTING.md](../CONTRIBUTING.md)。工单标题、补丁标记、CI 绿线仍以英文原文为准。

产品讲解（给谁、打开之后能做什么）：[BRIEF.zh.md](BRIEF.zh.md)。

产品路径是 Windows 上的 `scripts/setup-all.ps1`（局域网服务器）。`setup.sh` 只装内核，不起服务器。官方上游暂时不收外部 PR。产品向的 PR 只在**本仓**合。

## 参与门槛

不需要公司网、花名册、协作者权限。

1. 按 [README](../README.md) 在**本地目录**装一遍。setup 或第一次 `dsh --patch` 挂了，开 **Bug** 就有用。
2. 认领 [BUGS.md](../BUGS.md) 里列出的 id（目前没有待认领的；也可以自己提一个），开 **Task** issue（标题带该 id），再 fork + PR。
3. 验收看 `*_OK=1`，不看「我改了 README」。

技术细节、文件路径、Done when 写在英文 [BUGS.md](../BUGS.md)。

## 现在缺什么

C1–C9 和 C2b 已在英文 [BUGS.md](../BUGS.md) 全部标绿（含 Linux CIFS、本机 OAuth / 自定义端点 / 模型上下文，见 [MODELS.md](MODELS.md)），目前没有待认领的条目。发现缺口就提 Bug，或开一个 Task issue 写清问题和绿线（脚本打印的那一行才算完成）。

不是缺口：本地工作区（网络盘当沙箱根是故意拒绝的）；往官方仓提 PR；把公司网关 / 花名册搬进本仓。

## 怎么算做完

绿线写在 [BUGS.md](../BUGS.md) 对应 C# 的 **Done when**。路径和脚本名只用 ASCII。不要提交办公室 IP、密码、花名册、活的 `node_modules`。
