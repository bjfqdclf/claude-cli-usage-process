# claude-cli-usage-process

给 Claude CLI 的状态栏加一个本地近实时的 usage 展示。

## 使用方式

安装：

```bash
bash install.sh
```

卸载：

```bash
bash uninstall.sh
```

手动验证：

```bash
node scripts/usage-bar.js
```

安装完成后，重启 Claude CLI 即可生效。

当前版本的目标不是复刻 Anthropic 官方 quota 面板，而是提供一个尽量接近 Claude App 观感的本地估算状态栏：

- `sess`：按全账号最近 5 小时窗口估算
- `7d`：按全账号最近 7 天窗口估算
- `sess reset`：显示倒计时，例如 `in 3h 11m`
- `7d reset`：支持固定为类似 `Thu 3:59 PM` 的 App 风格时间

## 效果示例

```text
📊 sess █░░░░░░░ 14% 1.1K/7.8K reset in 3h 32m | 7d ░░░░░░░░ 2% 1.4K/70.0K reset Thu 3:59 PM | tok 5.9K~
```

字段说明：

- `sess`：最近 5 小时窗口的估算消耗
- `7d`：最近 7 天窗口的估算消耗
- `tok`：`~/.claude/stats-cache.json` 里最近一条 token 汇总
- `~`：表示 token 不是当天实时值，而是缓存值

## 能力边界

这个项目是“本地估算条”，不是官方真实额度面板。

- 能较快反映本机账号近期的使用趋势
- 不能保证和 Claude App / Pro / Max 的官方 quota 完全一致
- 不能直接读取官方剩余额度
- `sess reset` 是按本地 5 小时窗口估算
- `7d reset` 如果未显式配置，会退回到本地滚动窗口推断

适合用来盯使用趋势，不适合当账单或官方配额真值。

## 数据来源

近实时数据来自：

- `~/.claude/history.jsonl`

token 兜底数据来自：

- `~/.claude/stats-cache.json`

其中 `history.jsonl` 更接近实时，`stats-cache.json` 通常会有滞后。

## 文件结构

```text
install.sh
uninstall.sh
usage-config.json
scripts/
  usage-bar.js
.claude/
  settings.local.json
```

说明：

- [install.sh](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/install.sh)：一键安装到 `~/.claude/settings.json`
- [uninstall.sh](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/uninstall.sh)：一键恢复或移除全局状态栏配置
- [usage-config.json](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/usage-config.json)：周重置时间配置
- [usage-bar.js](/Users/bjfqdclf/Public/dev/claude-cli-usage-process/scripts/usage-bar.js)：核心状态栏脚本

## 安装

直接执行：

```bash
bash install.sh
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

安装完成后，重启 Claude CLI 即可生效。

## 卸载

直接执行：

```bash
bash uninstall.sh
```

它会自动：

- 先备份当前 `~/.claude/settings.json`
- 优先恢复最近一次备份
- 如果没有可恢复备份，则只移除当前项目写入的 `statusLine`

预览模式：

```bash
bash uninstall.sh --dry-run
```

## 手动验证

```bash
node scripts/usage-bar.js
```

如果只想自己接入，不使用安装脚本，可以在 `~/.claude/settings.json` 里写：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node /Users/bjfqdclf/Public/dev/claude-cli-usage-process/scripts/usage-bar.js"
  }
}
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

## 实现说明

实现策略很简单：

- 读取 `history.jsonl`
- 基于消息长度、slash command、上下文膨胀做一个估算
- 计算最近 5 小时和最近 7 天窗口
- 用 `stats-cache.json` 提供 token 补充信息

这样做的优点是依赖少、可移植、安装成本低。缺点是它永远只是估算，不会是官方真值。
