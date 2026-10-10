#!/usr/bin/env node
// Claude Code status line —— 复刻 pi 的 @reedchan/statusline 两行仪表。
// 严格输出两行；任何异常静默降级，不向外抛堆栈。

import fs from 'node:fs';

// 父进程可能在脚本写完前关掉读端；不挂这个监听，EPIPE 会变成未捕获异常并 exit 1
process.stdout.on('error', () => {});

// ── ANSI ────────────────────────────────────────────────
const ESC = '\u001b[';
const RESET = `${ESC}0m`;
const ANSI_RE = /\u001b\[[0-9;]*m/g;

const fg = (c, s) => `${ESC}${c}m${s}${RESET}`;
const dim = (s) => fg(2, s);
// 同色系的压暗版，给仪表轨道用：跟填充同一个色调，只降亮度
const fgDim = (c, s) => `${ESC}2;${c}m${s}${RESET}`;

const C = { accent: 36, warning: 33, error: 31, green: 32, brightGreen: 92, magenta: 35, blue: 34 };

// 终端可见宽度：盒绘/方块类字符算 1 列，CJK 算 2 列
function vw(s) {
  let n = 0;
  for (const ch of s.replace(ANSI_RE, '')) {
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f000 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    n += wide ? 2 : 1;
  }
  return n;
}

const WALL = dim('  |  ');

// ── 格式化 ──────────────────────────────────────────────
function fmtTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 999500) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

function fmtLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(2) + 's';
}

function fmtCost(usd) {
  if (!Number.isFinite(usd)) return '--';
  return '$' + usd.toFixed(2);
}

// deepseek-v4.1-flash（opencode-go 网关）价目，单位 $/M tokens。
// Claude Code 不认识这个模型，payload 里的 cost 是按 Claude 价目表瞎估的，所以自己算。
const RATES = { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 };

function calcCost(tk) {
  if (!tk) return null;
  return (
    tk.input * RATES.input +
    tk.output * RATES.output +
    tk.cacheRead * RATES.cacheRead +
    tk.cacheWrite * RATES.cacheWrite
  ) / 1e6;
}

const pair = (k, v) => dim(k) + ' ' + v;

// ── 仪表 ────────────────────────────────────────────────
const barColor = (pct) => (pct > 90 ? C.error : pct > 70 ? C.warning : C.accent);

// 缓存命中率越高越好，语义与上下文压力相反
const hitColor = (pct) => (pct >= 90 ? C.green : pct >= 70 ? C.warning : C.error);

function renderBar(pct, cells) {
  // 只用整格。半格收尾字符（▌ 之类）右半边是空的，会跟轨道之间留出一条可见的缝。
  const f = Math.max(0, Math.min(1, (Number.isFinite(pct) ? pct : 0) / 100));
  const whole = Math.round(f * cells);

  const c = barColor(pct);
  const fill = fg(c, '█'.repeat(whole));
  const track = fgDim(c, '░'.repeat(cells - whole));
  return fill + track;
}

function pctText(pct) {
  if (!Number.isFinite(pct)) return '--';
  const s = Math.round(pct) + '%';
  if (pct > 90) return fg(C.error, s);
  if (pct > 70) return fg(C.warning, s);
  return s;
}

// ── payload 解包 ────────────────────────────────────────
// 模型名来自 env 与网关目录，可能夹带换行或 OSC 序列 —— 会撑破两行结构、让宽度算错。
// 顺带去掉尾部的窗口标记（如 [1M]），它既不影响识别又很占地方。
const sanitizeModel = (s) =>
  String(s)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/\[[^\]]*\]$/, '');
function unpack(p) {
  const cw = p.context_window ?? {};
  const cache = p.prompt_cache ?? {};
  const home = (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/');

  const cwdFull = String(p.workspace?.current_dir ?? p.cwd ?? '');
  let cwd = cwdFull.replace(/\\/g, '/');
  if (home) {
    const h = home.toLowerCase();
    const cl = cwd.toLowerCase();
    if (cl === h || cl.startsWith(h + '/')) cwd = '~' + cwd.slice(home.length);
  }

  return {
    pct: Number.isFinite(cw.used_percentage) ? cw.used_percentage : null,
    tokens: cw.total_input_tokens ?? 0,
    window: cw.context_window_size ?? 0,
    inTok: cw.total_input_tokens ?? 0,
    outTok: cw.total_output_tokens ?? 0,
    hit: Number.isFinite(cache.hit_ratio) ? cache.hit_ratio * 100 : null,
    cost: p.cost?.total_cost_usd,
    model: sanitizeModel(p.model?.display_name ?? p.model?.id ?? ''),
    effort: p.effort?.level ?? null,
    cwd,
    transcript: p.transcript_path ?? '',
  };
}

// ── transcript 解析 ─────────────────────────────────────
// 只读末尾窗口。每条 assistant 记录的时间戳 ≈ 该内容块流式结束的时刻；
// 同一条消息被拆成多行且共享同一份 usage，必须按 message.id 去重。
function readTail(file, maxBytes = 16777216) {
  try {
    const st = fs.statSync(file);
    if (st.size <= maxBytes) return fs.readFileSync(file, 'utf8').split('\n');

    // 超长会话只读末尾一段，丢掉可能被截断的首行
    let text = '';
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const read = fs.readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
      text = buf.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }

    const nl = text.indexOf('\n');
    return (nl >= 0 ? text.slice(nl + 1) : '').split('\n');
  } catch {
    return [];
  }
}

function analyzeTurns(lines) {
  const msgs = new Map();
  let prevTs = null;
  let lastModel = null;
  let lastEffort = null;

  for (const line of lines) {
    if (!line) continue;

    let r;
    try { r = JSON.parse(line); } catch { continue; }

    const ts = Date.parse(r?.timestamp ?? '');
    if (!Number.isFinite(ts)) continue;

    if (r.requestedModel) lastModel = r.requestedModel;
    if (r.effort) lastEffort = r.effort;

    if (r.type !== 'assistant') {
      prevTs = ts;
      continue;
    }

    const id = r.message?.id;
    if (!id) continue;

    let m = msgs.get(id);
    if (!m) {
      m = { first: ts, last: ts, out: 0, inTok: 0, cacheRead: 0, cacheWrite: 0, think: 0, anchor: prevTs, ttft: null };
      msgs.set(id, m);
    }
    m.last = ts;

    // 一条消息会拆成多个 block 分别落盘，首块（apiBlockIndex 0）的 usage 常是 0，
    // 真实用量在后面的块上 —— 每块都取最大值，不能只在建条目时快照一次。
    const u = r.message?.usage;
    if (u) {
      m.out = Math.max(m.out, u.output_tokens ?? 0);
      m.inTok = Math.max(m.inTok, u.input_tokens ?? 0);
      m.cacheRead = Math.max(m.cacheRead, u.cache_read_input_tokens ?? 0);
      m.cacheWrite = Math.max(m.cacheWrite, u.cache_creation_input_tokens ?? 0);
    }

    if (r.apiBlockIndex === 0 && Number.isFinite(r.thinkingDurationMs)) m.think = r.thinkingDurationMs;
  }

  const list = [...msgs.values()].sort((a, b) => a.first - b.first);

  let sumOut = 0, sumDecode = 0, lastTps = null;

  for (const m of list) {
    const start = m.first - m.think; // thinking 起点 ≈ 解码起点
    const decodeMs = m.last - start;

    if (decodeMs >= 200 && m.out > 0) {
      const tps = m.out / (decodeMs / 1000);
      if (tps > 0 && tps < 5000) {
        lastTps = tps;
        sumOut += m.out;
        sumDecode += decodeMs;
      }
    }

    if (m.anchor != null) {
      const ttft = start - m.anchor;
      if (ttft > 0 && ttft < 60000) m.ttft = ttft;
    }
  }

  const tail = list[list.length - 1];

  let tIn = 0, tOut = 0, tCacheRead = 0, tCacheWrite = 0;
  for (const m of list) {
    tIn += m.inTok;
    tOut += m.out;
    tCacheRead += m.cacheRead;
    tCacheWrite += m.cacheWrite;
  }

  return {
    lastTps,
    avgTps: sumDecode > 0 ? sumOut / (sumDecode / 1000) : null,
    lastTtft: tail?.ttft ?? null,
    model: lastModel,
    effort: lastEffort,
    tokens: { input: tIn, output: tOut, cacheRead: tCacheRead, cacheWrite: tCacheWrite },
  };
}

// ── 行组装 ──────────────────────────────────────────────
function truncate(s, width) {
  if (vw(s) <= width) return s;

  let out = '';
  let n = 0;
  const re = /(\u001b\[[0-9;]*m)|([\s\S])/gu;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) { out += m[1]; continue; }
    const w = vw(m[2]);
    if (n + w > width - 1) { out += dim('…'); break; }
    out += m[2];
    n += w;
  }
  return out + RESET;
}

// 左段尽量省地方：仪表固定格数且不带标签（仪表本身就能认出来）
const BAR_CELLS = 16;

function row1Left(c, detail) {
  let s = renderBar(c.pct, BAR_CELLS) + '  ' + pctText(c.pct);
  if (detail && c.window > 0 && c.tokens > 0) {
    s += '   ' + dim(fmtTokens(c.tokens) + ' / ' + fmtTokens(c.window));
  }
  return s;
}

// 第二行左段只放模型名，不显示工作区与分支
function row2Left(c) {
  return c.model ? fg(C.blue, c.model) : '';
}

// 右段按列排布：两行同列共享列宽，所以每个字段的首字母都落在同一列。
// 列序固定，被丢弃的字段留 null 占位，后面的列不会错位。
const CELLS = 4;

function fieldCells(c, t, a) {
  const r1 = [
    a.input && t.tokens.input > 0 ? pair('Input', fmtTokens(t.tokens.input)) : null,
    a.output && t.tokens.output > 0 ? pair('Output', fmtTokens(t.tokens.output)) : null,
    a.hit && c.hit != null ? dim('Cache hit') + ' ' + fg(hitColor(c.hit), c.hit.toFixed(1) + '%') : null,
    a.money ? pair('Cost', fmtCost(c.cost)) : null,
  ];

  const r2 = [
    a.effort && c.effort ? dim('Effort') + ' ' + fg(C.magenta, c.effort) : null,
    a.ttft && t.lastTtft != null ? pair('TTFT', fmtLatency(t.lastTtft)) : null,
    a.last && t.lastTps != null
      ? dim('Last') + ' ' + fg(t.lastTps >= 150 ? C.brightGreen : C.accent, Math.round(t.lastTps) + ' tok/s')
      : null,
    a.avg && t.avgTps != null ? pair('Avg', Math.round(t.avgTps) + ' tok/s') : null,
  ];

  return [r1, r2];
}

const padTo = (s, w) => s + ' '.repeat(Math.max(0, w - vw(s)));

// 按「列」丢，两行同步：剩下的列永远语义对应
// （Input↔Effort、Output↔TTFT、Cache hit↔Last、Cost↔Avg）。
// 从右往左丢，最后一档保底留着 Input↔Effort，任何宽度下都有内容。
const LADDER = [
  { input: 1, output: 1, hit: 1, money: 1, effort: 1, ttft: 1, last: 1, avg: 1 },
  { input: 1, output: 1, hit: 1, money: 0, effort: 1, ttft: 1, last: 1, avg: 0 },
  { input: 1, output: 1, hit: 0, money: 0, effort: 1, ttft: 1, last: 0, avg: 0 },
  { input: 1, output: 0, hit: 0, money: 0, effort: 1, ttft: 0, last: 0, avg: 0 },
];

function renderPair(c, t, a, l1, l2, width) {
  const [r1, r2] = fieldCells(c, t, a);

  // 两行都空的列整列略过，否则尾部会拖出一串空分隔符
  const live = [];
  for (let i = 0; i < CELLS; i++) {
    if (r1[i] || r2[i]) live.push(i);
  }
  if (!live.length) return null;

  const w = live.map((i) => Math.max(r1[i] ? vw(r1[i]) : 0, r2[i] ? vw(r2[i]) : 0));

  // 只有一行有内容的列也要占位，两行 body 等宽、右边缘才能严格对齐
  const body = (cells) =>
    live.map((i, k) => (cells[i] ? padTo(cells[i], w[k]) : ' '.repeat(w[k]))).join(WALL);

  const b1 = body(r1);
  const b2 = body(r2);
  const bodyW = Math.max(vw(b1), vw(b2));
  if (!bodyW) return null;

  // 整块右段贴右边缘；左段太长时才退回紧跟其后
  const start = Math.max(Math.max(vw(l1), vw(l2)) + 3, width - bodyW);

  const n1 = l1 + ' '.repeat(Math.max(1, start - vw(l1))) + b1;
  const n2 = l2 + ' '.repeat(Math.max(1, start - vw(l2))) + b2;

  return vw(n1) <= width && vw(n2) <= width ? [n1, n2] : null;
}

const countOn = (a) => Object.values(a).reduce((s, v) => s + (v ? 1 : 0), 0);

function buildLines(c, t, width) {
  // 左段只有两档：带 tokens/window、不带。左段越短右段能留的列越多。
  const l2 = row2Left(c);
  const plans = [
    { l1: row1Left(c, true), l2, w: 1 },
    { l1: row1Left(c, false), l2, w: 0 },
  ];

  let best = null;

  for (const plan of plans) {
    for (const a of LADDER) {
      const out = renderPair(c, t, a, plan.l1, plan.l2, width);
      if (!out) continue;

      // 右段字段数优先（压过左段完整度），同分再比左段
      const score = countOn(a) * 10 + plan.w;
      if (!best || score > best.score) best = { out, score };
    }
  }

  if (best) return best.out;

  return [
    truncate(row1Left(c, false), width),
    truncate(l2, width),
  ];
}

// ── main ────────────────────────────────────────────────
async function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) raw += chunk;

  const p = JSON.parse(raw || '{}');
  const c = unpack(p);

  const cols = parseInt(process.env.COLUMNS ?? '', 10);
  // Claude Code 渲染时自己会吃掉几列，边距留不够它就把整行尾巴砍成 "..."。
  // 6 是实测不触发截断的下限 —— 降到这里以下，本脚本的整列丢弃就来不及生效。
  const width = Math.max(20, (Number.isFinite(cols) && cols > 0 ? cols : 120) - 6);

  const turns = analyzeTurns(readTail(c.transcript));

  // payload 缺 model / effort 时（插件、子会话上下文里常见）从 transcript 回退
  if (!c.model && turns.model) c.model = sanitizeModel(turns.model);
  if (!c.effort && turns.effort) c.effort = turns.effort;

  // 用实际模型价目重算花费。transcript 读不到时（远端会话下发空路径、会话刚起）
  // 宁可显示 "--"，也不要退回 payload 那个按 Claude 价目表估的值 —— 实测能差 55 倍。
  const tk = turns.tokens;
  const hasUsage = tk && tk.input + tk.output + tk.cacheRead + tk.cacheWrite > 0;
  c.cost = hasUsage ? calcCost(tk) : null;

  const [l1, l2] = buildLines(c, turns, width);
  process.stdout.write(l1 + '\n' + l2);
}

main().catch((e) => {
  try {
    process.stdout.write(fg(C.error, 'statusline error') + '\n ');
  } catch {}
  if (process.env.CLAUDE_STATUSLINE_DEBUG) process.stderr.write(String(e?.stack ?? e) + '\n');
});
