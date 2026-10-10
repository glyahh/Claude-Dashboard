<div align="center">

# Claude Dashboard

**A live two-line status line for Claude Code** — context window, cache hit rate, time-to-first-token and
token throughput, always in view.

[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](pi-style.mjs)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

[English](README.md) · [简体中文](README.zh-CN.md)

```
██████████░░░░░░  63%   616k / 1.0M      Input 455k | Output 333k | Cache hit 99.4% | Cost $0.51
deepseek-v4.1-flash                     Effort high | TTFT 6.5s | Last 233 tok/s | Avg 257 tok/s
```

<sub>Your screenshot here — replace this block with a real terminal capture for the best first impression.</sub>

</div>

## Why

Claude Code's built-in status line tells you the model and not much else. This one answers the questions you
actually ask mid-session:

- **How full is my context, really?** A fixed-width meter with 70% / 90% pressure colours.
- **Am I still hitting the prompt cache?** Cache hit rate, coloured green when healthy.
- **How fast is the model right now?** Time to first token and decode throughput, per turn and averaged.
- **What has this session cost?** Recomputed against your own model's prices, not Claude's list price.

**Design credit.** The two-line layout, the fixed-width meter, the right-aligned column grid and the
highlight palette are all inspired by [`@reedchan/statusline`](https://pi.dev/packages/@reedchan/statusline),
a plugin for the [pi](https://pi.dev) coding agent. This project reimplements that look for Claude Code,
where timing data has to be reconstructed from the session transcript rather than read off live streaming
events.

## Install

### Option A — hand it to your coding agent

Paste this into Claude Code, Cursor, or any agent that can run shell commands:

> Install the Claude Dashboard status line for Claude Code. Clone
> `https://github.com/glyahh/Claude-Dashboard` into `~/.claude/statusline/`, then add the `statusLine` block
> from `settings.example.json` to `~/.claude/settings.json`, using the absolute path to `pi-style.mjs` on
> this machine and forward slashes if it is Windows. Verify it works by piping a small JSON payload into the
> script and confirming it prints two rows instead of crashing.

### Option B — manual

```bash
git clone https://github.com/glyahh/Claude-Dashboard ~/.claude/statusline
```

Then add this to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/statusline/pi-style.mjs",
    "refreshInterval": 2
  }
}
```

On Windows use forward slashes — backslashes get eaten as escapes by Git Bash.

No `npm install`, no build step, no config file. The script imports only `node:fs`.

## What you see

| Field | Meaning |
| --- | --- |
| `██████████░░░░░░  63%` | Context window occupancy, 16 cells, fixed width — never stretched to the terminal |
| `616k / 1.0M` | Tokens in context / window size |
| `Input` / `Output` | Running session totals, deduped per message |
| `Cache hit` | Prompt-cache read share of all input tokens |
| `Cost` | Session spend at your model's list price |
| `<model>` | Active model |
| `Effort` | Current reasoning effort level |
| `TTFT` | Time from request to first token |
| `Last` / `Avg` | Decode throughput for the newest turn, and the session average |

Columns drop whole and in pairs as the window narrows, so what survives always stays semantically aligned
(`Input`↔`Effort`, `Output`↔`TTFT`, `Cache hit`↔`Last`, `Cost`↔`Avg`). Nothing is ever half-cut.

## Configuration

Everything tunable sits at the top of `pi-style.mjs`:

| Constant | Default | What it does |
| --- | --- | --- |
| `RATES` | DeepSeek V4.1 Flash list prices | `$` per million tokens for `input` / `output` / `cacheRead` / `cacheWrite`. **Change these for your model** — everything else is model-agnostic. |
| `BAR_CELLS` | `16` | Meter width in cells. Set it to `20` to match the pi original. |
| `C` | ANSI codes | The palette: `accent` (meter, model, cache), `warning`, `error`, `green`, `magenta` (effort), `blue`. |

`width = COLUMNS - 6`. That margin is load-bearing: Claude Code pads its own status line, and leaving it less
makes Claude Code truncate the tail before this script's column dropping can run.

## How it works

The script reads one JSON payload from stdin (Claude Code's status line contract) and writes exactly two rows.
Everything timing-related comes from the session transcript, because the payload carries no per-request timing:

- **TTFT** — `(first block timestamp − previous record timestamp) − thinkingDurationMs`
- **tok/s** — `output_tokens / (last block timestamp − thinking start)`, deduped by `message.id`
- **Cost** — summed token usage × `RATES`

Two things worth knowing before you trust the numbers:

- **TTFT reads higher than a pure first-token measurement.** It includes queueing and prefill, because those
  timestamps are the only ones the transcript exposes.
- **`Last`/`Avg` lag by one turn.** The transcript is only readable after a turn is fully written out, so the
  turn currently streaming is not counted yet.

## Limitations

- `Cache hit` is whole-session, not per-turn.
- Very long sessions are read from the tail of the transcript only (16 MiB cap).
- Re-parsing costs roughly 0.2 s on a 20 MB session, against a 2 s refresh interval.

## License

[MIT](LICENSE)
