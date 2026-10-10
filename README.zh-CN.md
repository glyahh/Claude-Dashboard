<div align="center">

# Claude Dashboard

**给 Claude Code 用的两行实时仪表** —— 上下文窗口、缓存命中、首字时间、token 速率，一直看得见。

[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](pi-style.mjs)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

[English](README.md) · [简体中文](README.zh-CN.md)

```
██████████░░░░░░  63%   616k / 1.0M      Input 455k | Output 333k | Cache hit 99.4% | Cost $0.51
deepseek-v4.1-flash                     Effort high | TTFT 6.5s | Last 233 tok/s | Avg 257 tok/s
```

<sub>建议把这里换成一张真实终端截图，第一印象会好很多。</sub>

</div>

## 为什么

Claude Code 自带的底栏只告诉你模型名。这条回答的是会话进行中你真正会问的问题：

- **上下文还剩多少？** 固定宽度仪表，70% / 90% 两级压力变色。
- **还在命中缓存吗？** 缓存命中率，健康时显示绿色。
- **模型现在多快？** 首字时间和解码速率，逐轮值和会话平均各一个。
- **这个会话花了多少？** 按你自己模型的价格重算，不是 Claude 的价目表。

**设计出处**：两行布局、固定宽度仪表、右对齐的列网格和高亮配色，都来自 [pi](https://pi.dev) 编码助手的插件
[`@reedchan/statusline`](https://pi.dev/packages/@reedchan/statusline)。本项目把那个观感搬到 Claude Code ——
这边的时间数据得从会话 transcript 反推，不像 pi 能直接读流式事件，所以 TTFT 和 token 速率的数值口径并不相同。

## 安装

### 方式 A —— 交给你的编码 agent

把下面这段丢进 Claude Code、Cursor，或任何能跑 shell 命令的 agent：

> 帮我装 Claude Dashboard 这个 Claude Code 状态栏。把 `https://github.com/glyahh/Claude-Dashboard`
> 克隆到 `~/.claude/statusline/`，再把 `settings.example.json` 里的 `statusLine` 段加进
> `~/.claude/settings.json`，`command` 用本机上 `pi-style.mjs` 的绝对路径，Windows 下记得用正斜杠。
> 最后往脚本里喂一段 JSON 验证它是输出两行而不是报错。

### 方式 B —— 手动

```bash
git clone https://github.com/glyahh/Claude-Dashboard ~/.claude/statusline
```

然后往 `~/.claude/settings.json` 里加：

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline/pi-style.mjs",
    "refreshInterval": 2
  }
}
```

Windows 上必须用正斜杠 —— 反斜杠会被 Git Bash 当转义吃掉。

不用 `npm install`，没有构建步骤，不用额外配置文件。脚本只 import 了 `node:fs`。

## 显示什么

| 字段 | 含义 |
| --- | --- |
| `██████████░░░░░░  63%` | 上下文占用，16 格固定宽度，永不拉伸到终端宽度 |
| `616k / 1.0M` | 窗口内 token 数 / 窗口上限 |
| `Input` / `Output` | 会话累计，按 message 去重 |
| `Cache hit` | 缓存读 token 占全部输入的比例 |
| `Cost` | 按你模型价目表算出的会话花费 |
| `<模型名>` | 当前模型 |
| `Effort` | 当前思考力度 |
| `TTFT` | 从发出请求到第一个 token 的耗时 |
| `Last` / `Avg` | 最新一轮的解码速率，以及会话平均 |

窗口变窄时整列成对丢弃，剩下的永远保持语义对应（`Input`↔`Effort`、`Output`↔`TTFT`、`Cache hit`↔`Last`、
`Cost`↔`Avg`），不会出现被切一半的字段。

## 配置

所有可调项都在 `pi-style.mjs` 顶部：

| 常量 | 默认值 | 作用 |
| --- | --- | --- |
| `RATES` | DeepSeek V4.1 Flash 价格 | `input` / `output` / `cacheRead` / `cacheWrite` 的每百万 token 美元价。**换了模型一定要改这几项**，其余代码与模型无关。 |
| `BAR_CELLS` | `16` | 仪表格数。设成 `20` 就是 pi 原版的宽度。 |
| `C` | ANSI 色号 | 配色：`accent`（仪表、模型、缓存）、`warning`、`error`、`green`、`magenta`（力度）、`blue`。 |

`width = COLUMNS - 6`。这个边距是有用的：Claude Code 渲染时会自己吃掉几列，留不够它就会抢先把行尾砍成
`Avg 257 to...`，本脚本的整列丢弃根本来不及触发。

## 原理

脚本从 stdin 读一段 JSON（Claude Code 的状态栏契约），输出恰好两行。所有跟时间有关的量都来自会话
transcript，因为 payload 里没有任何单次请求的时序字段：

- **TTFT** —— `(首块时间戳 − 上一条记录时间戳) − thinkingDurationMs`
- **token 速率** —— `output_tokens / (末块时间戳 − thinking 起点)`，按 `message.id` 去重
- **花费** —— 累计 token × `RATES`

信这两个数之前，先知道两件事：

- **TTFT 会比纯首字测量偏大**，因为里面含了排队和 prefill —— transcript 只暴露这些时间戳。
- **`Last` / `Avg` 滞后一轮**：transcript 要等一轮完全写完才读得到，所以正在流式输出的那一轮不计入。

## 限制

- `Cache hit` 是全会话口径，不是最近一轮。
- 超长会话只读 transcript 末尾一段（上限 16 MiB）。
- 每次刷新重新解析，20 MB 的会话约 0.2 秒，刷新间隔是 2 秒。

## 许可

[MIT](LICENSE)
