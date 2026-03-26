# claude-cli-usage-process

给 Claude CLI 的状态栏加一个 usage 展示：macOS 上优先读取官方 usage API 真值，失败时回退到本地近实时估算，尽量贴近 Claude App 的 session / weekly 进度观感。

适合想在 CLI 里快速看到“当前 5 小时窗口用了多少、最近 7 天大概用了多少、什么时候重置”的用户。

## 效果

```text
📊 sess ███░░░░░ 31% reset in 2h 18m | 7d ██░░░░░░ 22% reset Thu 3:59 PM | tok 5.9K~
```

## 快速开始

| 操作 | macOS / Linux | Windows PowerShell |
| --- | --- | --- |
| 下载代码 | `git clone https://github.com/bjfqdclf/claude-cli-usage-process.git && cd claude-cli-usage-process` | `git clone https://github.com/bjfqdclf/claude-cli-usage-process.git; cd claude-cli-usage-process` |
| 安装 | `bash install.sh` | `.\install.ps1` |
| 验证 | `node scripts/usage-bar.js` | `node .\scripts\usage-bar.js` |
| 卸载 | `bash uninstall.sh` | `.\uninstall.ps1` |

安装或卸载后，重启 Claude CLI 即可生效。

说明：

- macOS 默认优先走官方 usage API
- Linux 和 Windows 默认走本地估算

## 亮点

- `sess`：macOS 上优先显示官方 5 小时窗口真值
- `7d`：macOS 上优先显示官方 7 天窗口真值
- `sess reset`：显示倒计时，例如 `in 3h 11m`
- `7d reset`：官方模式显示服务端重置时间，估算模式支持固定成类似 `Thu 3:59 PM`
- `tok`：显示 `stats-cache.json` 里的 token 缓存值
- `est`：表示当前已回退到本地估算模式
- 自带 [install.sh](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/install.sh) 和 [uninstall.sh](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/uninstall.sh)
- 自带 Bash 和 PowerShell 安装 / 卸载脚本

## 适用场景

- 你主要在 Claude CLI 里工作，想随时看 usage 趋势
- 你想在 CLI 里优先看到官方 session / weekly 真值
- 你接受在官方数据不可用时退回本地估算

## 字段说明

- `sess`：最近 5 小时窗口用量，官方模式显示真值，估算模式显示本地推算
- `7d`：最近 7 天窗口用量，官方模式显示真值，估算模式显示本地推算
- `tok`：`~/.claude/stats-cache.json` 里最近一条 token 汇总
- `~`：表示 token 不是当天实时值，而是缓存值
- `est`：表示这一行是 fallback 估算值，不是官方服务端账本

## 能力边界

这个项目默认是“官方优先 + 本地回退”，不是完整官方面板。

- macOS 上会尝试读取本机 Claude 凭据并调用官方 usage API
- 官方路径失败时，会自动回退到本地估算
- 非 macOS 环境默认只能走估算模式
- 不能保证和 Claude App / Pro / Max 的所有隐藏额度字段完全一致
- `sess reset` 和 `7d reset` 在估算模式下仍然是本地推断

适合用来盯趋势；在 macOS 上，`sess/7d` 会尽量使用官方真值。

## 数据来源

官方数据来自：

- macOS Keychain 中的 Claude OAuth 凭据
- `https://api.anthropic.com/api/oauth/usage`

本地回退数据来自：

- `~/.claude/history.jsonl`

token 兜底数据来自：

- `~/.claude/stats-cache.json`

其中官方 usage API 优先；`history.jsonl` 用于 fallback 估算，`stats-cache.json` 通常会有滞后。

## 文件结构

```text
install.sh
install.ps1
uninstall.sh
uninstall.ps1
usage-config.json
scripts/
  usage-bar.js
```

说明：

- [install.sh](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/install.sh)：一键安装到 `~/.claude/settings.json`
- [install.ps1](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/install.ps1)：Windows PowerShell 一键安装
- [uninstall.sh](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/uninstall.sh)：一键恢复或移除全局状态栏配置
- [uninstall.ps1](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/uninstall.ps1)：Windows PowerShell 一键卸载
- [usage-config.json](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/usage-config.json)：周重置时间配置
- [usage-bar.js](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/scripts/usage-bar.js)：核心状态栏脚本

## 安装

直接执行：

```bash
bash install.sh
```

Windows PowerShell：

```powershell
.\install.ps1
```

它会自动：

- 写入 `~/.claude/settings.json`
- 设置 `statusLine.command`
- 在修改前备份 `~/.claude/settings.json`
- 只保留最近 20 份备份

预览模式：

```bash
bash install.sh --dry-run
```

Windows PowerShell：

```powershell
.\install.ps1 --dry-run
```

## 卸载

直接执行：

```bash
bash uninstall.sh
```

Windows PowerShell：

```powershell
.\uninstall.ps1
```

它会自动：

- 先备份当前 `~/.claude/settings.json`
- 优先恢复最近一次备份
- 如果没有可恢复备份，则只移除当前项目写入的 `statusLine`

预览模式：

```bash
bash uninstall.sh --dry-run
```

Windows PowerShell：

```powershell
.\uninstall.ps1 --dry-run
```

## 手动接入

如果不使用安装脚本，可以在 `~/.claude/settings.json` 里写：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/bjfqdclf/Public/dev/claude-cli-usage-process/scripts/usage-bar.js"
  }
}
```

手动验证命令：

```bash
node scripts/usage-bar.js
```

## 周重置时间配置

仓库根目录的 [usage-config.json](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/usage-config.json) 用来固定周重置时间。

当前配置示例：

```json
{
  "weeklyReset": {
    "type": "fixed",
    "weekday": 4,
    "hour": 15,
    "minute": 59
  }
}
```

这会显示为：

```text
reset Thu 3:59 PM
```

`weekday` 采用 JavaScript 的星期编号：

- `0` = `Sun`
- `1` = `Mon`
- `2` = `Tue`
- `3` = `Wed`
- `4` = `Thu`
- `5` = `Fri`
- `6` = `Sat`

## 可调参数

脚本支持环境变量覆盖默认值：

- `USAGE_MODE`：默认 `auto`，可选 `auto`、`official`、`estimate`
- `USAGE_API_TIMEOUT_MS`：默认 `4000`
- `CLAUDE_KEYCHAIN_SERVICE`：默认 `Claude Code-credentials`
- `CURRENT_SESSION_TOKEN_BUDGET`：默认 `7800`
- `WEEKLY_TOKEN_BUDGET`：默认 `70000`
- `BAR_WIDTH`：默认 `8`
- `MAX_HISTORY_BYTES`：默认 `8388608`
- `CHARS_PER_TOKEN`：默认 `4`
- `BASE_PROMPT_TOKENS`：默认 `24`
- `SLASH_COMMAND_BASE_TOKENS`：默认 `10`
- `ASSISTANT_REPLY_MULTIPLIER`：默认 `2.4`
- `CONTEXT_GROWTH_RATE`：默认 `0.18`
- `CONTEXT_WINDOW_TOKENS`：默认 `12000`

示例：

```bash
CURRENT_SESSION_TOKEN_BUDGET=10000 WEEKLY_TOKEN_BUDGET=80000 node scripts/usage-bar.js
```

强制只用官方模式：

```bash
USAGE_MODE=official node scripts/usage-bar.js
```

强制只用本地估算：

```bash
USAGE_MODE=estimate node scripts/usage-bar.js
```

## FAQ

### 为什么有时前面会出现 `est`？

表示这一行不是官方服务端返回值，而是本地估算值。

出现 `est` 通常有几种情况：

- 当前不是 macOS，无法读取 macOS Keychain
- Claude 凭据不在本机 Keychain 里，或服务名不匹配
- 官方 usage API 请求失败、超时或返回异常
- 你显式设置了 `USAGE_MODE=estimate`

### 为什么和 Claude App 显示的不完全一样？

因为这个状态栏不是 Claude App 的完整镜像，只复用了其中一部分信息源。

- `sess` 和 `7d` 在官方模式下来自 usage API，但只显示百分比和 reset，不展示 App 里的全部隐藏字段
- `tok` 仍然来自本地 `stats-cache.json`，不是官方账本值
- 只要官方路径失败，脚本就会自动回退到本地估算
- 估算模式依赖 `history.jsonl`、经验参数和本地窗口推断，本身就不可能和服务端完全一致

### 为什么 weekly reset 可以显示成 `Thu 3:59 PM`？

因为这里有两套来源：

- 官方模式：优先使用 usage API 返回的 `resets_at`
- 估算模式：使用 [usage-config.json](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/usage-config.json) 里的固定周重置时间

所以你看到 `Thu 3:59 PM`，可能是两种情况：

- 当前在官方模式，服务端返回的 reset 被格式化成这个时间
- 当前在估算模式，脚本使用了本地固定周重置时间

### 为什么有时 token 后面有 `~`？

表示 `tok` 用的是 `stats-cache.json` 里的最近可用缓存，而不是当天实时新值。

常见原因：

- 今天的数据还没写入缓存
- 当前只拿到了最近一条历史 token 汇总
- Claude CLI 本地统计刷新比 usage API 更慢

## 实现说明

脚本按“官方优先，估算回退”的顺序工作。

执行流程：

1. 读取 `USAGE_MODE`
2. 如果允许官方模式，且当前在 macOS：
3. 通过 `/usr/bin/security find-generic-password` 从 Keychain 读取 Claude 凭据
4. 从凭据 JSON 中提取 `claudeAiOauth.accessToken`
5. 调用 `https://api.anthropic.com/api/oauth/usage`
6. 如果拿到 `five_hour` / `seven_day`，直接输出官方 `sess` 和 `7d`
7. 如果上面任一步失败，则回退到本地估算
8. 本地估算会读取 `history.jsonl`，按最近 5 小时和最近 7 天窗口计算估算消耗
9. 如果 `stats-cache.json` 里有可用数据，就追加显示 `tok`

输出规则：

- 官方成功：显示 `sess ... | 7d ... | tok ...`
- 官方失败或被禁用，且本地有可用历史：显示 `est sess ... | 7d ... | tok ...`
- 完全没有可用本地记录时：显示“当前项目暂无近实时记录”

这样做的目的，是在 macOS 上尽量靠近官方真值，同时保持脚本仍然可独立运行，不把整个项目绑死在 Keychain 或 Anthropic 接口上。
