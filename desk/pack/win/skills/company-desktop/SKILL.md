---
name: company-desktop
description: Operating Windows desktop apps (Jianying and others) with the bundled Windows-MCP tools.
whenToUse: 剪映, 桌面软件, 点界面, 导出, 打开软件, 窗口.
disable-model-invocation: true
---

# company-desktop

Windows 客户端自带 Windows-MCP。它操作的是员工这台电脑上已经打开的桌面软件。网页仍然用 OpenCLI（见 `company-web`），命令仍然用自己的 shell。Mac 客户端没有这一套工具。

## 1. 工具

工具名都是 `mcp__windows__<名字>`：

- `Snapshot`：读窗口列表和界面元素（按钮、输入框，带坐标和编号）。先用它。
- `Screenshot`：截图。界面元素读不到时用；`width_reference_line` / `height_reference_line` 加网格线，方便算坐标。
- `Click` / `Type` / `Scroll` / `Move`（拖动）/ `Shortcut`：动作。能按编号（`label`）点就不要按坐标点。
- `App`：启动或切换窗口（`mode: switch`，`name` 写窗口标题）。
- `Wait` / `WaitFor`：等界面变化。

没有注册表、没有 PowerShell 工具。点不了管理员权限弹窗（UAC）。每次工具调用 60 秒上限，长操作拆成多步。

## 2. 每一步的规矩

1. 动作前先 `Snapshot` 或 `Screenshot` 看当前状态，动作后再看一次，确认变了、变对了。
2. 点错了：`Shortcut` 发 `ctrl+z` 撤回，再看一次。连续两次点不准就停下告诉员工，不要乱试。
3. 会改文件或发出去的动作先问员工，得到「可以」再做：导出、保存覆盖、删除、发送消息、提交表单。
4. 员工自己正在用的窗口，切走之前说一声。不要读和本任务无关的聊天窗口内容。
5. 不输入密码。需要登录就请员工自己登。

## 3. 剪映专业版

- 剪映是自绘界面：`Snapshot` 只认得出整个窗口，认不出里面的按钮。用 `Screenshot` 看画面，按坐标点。
- 剪辑本身（切、删、排轨道、字幕、配乐）走 koubo 写草稿：更快，切点精确到帧，可批量出多个版本。点界面只做草稿做不到的事：剪映在线素材和 AI 功能（智能包装、模板、特效、数字人）、打开草稿检查、播放、导出。
- koubo 写某个草稿之前，这个草稿不能在剪映里开着（剪映保存时会把外面的改动覆盖掉）。先回到剪映首页或关掉该草稿。
- 时间线上用快捷键比拖鼠标准：`ctrl+b` 分割，`q` 删播放头左边，`w` 删播放头右边，`delete` 删选中，空格播放/暂停，`left` / `right` 逐帧，`ctrl+z` 撤销。放播放头：先读时间尺刻度换算出像素位置，点时间尺，再看预览下方的时间码核对。
- 导出：右上角蓝色「导出」。先读出导出设置（名称、位置、分辨率、帧率）给员工看，员工确认后再点最后的导出。导出要等，用 `WaitFor` 或隔一会儿截图看进度，不要一直点。
