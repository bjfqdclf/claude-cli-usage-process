#!/usr/bin/env node
// Claude CLI StatusLine hook: approximate near-real-time usage for the current project.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CURRENT_SESSION_TOKEN_BUDGET = Number(process.env.CURRENT_SESSION_TOKEN_BUDGET || 7800);
const WEEKLY_TOKEN_BUDGET = Number(process.env.WEEKLY_TOKEN_BUDGET || 70000);
const BAR_WIDTH = Number(process.env.BAR_WIDTH || 8);
const MAX_HISTORY_BYTES = Number(process.env.MAX_HISTORY_BYTES || 8 * 1024 * 1024);
const CHARS_PER_TOKEN = Number(process.env.CHARS_PER_TOKEN || 4);
const BASE_PROMPT_TOKENS = Number(process.env.BASE_PROMPT_TOKENS || 24);
const SLASH_COMMAND_BASE_TOKENS = Number(process.env.SLASH_COMMAND_BASE_TOKENS || 10);
const ASSISTANT_REPLY_MULTIPLIER = Number(process.env.ASSISTANT_REPLY_MULTIPLIER || 2.4);
const CONTEXT_GROWTH_RATE = Number(process.env.CONTEXT_GROWTH_RATE || 0.18);
const CONTEXT_WINDOW_TOKENS = Number(process.env.CONTEXT_WINDOW_TOKENS || 12000);
const USAGE_MODE = (process.env.USAGE_MODE || 'auto').toLowerCase();
const USAGE_API_TIMEOUT_MS = Number(process.env.USAGE_API_TIMEOUT_MS || 4000);
const CLAUDE_KEYCHAIN_SERVICE = process.env.CLAUDE_KEYCHAIN_SERVICE || 'Claude Code-credentials';

const HISTORY_PATH = path.join(os.homedir(), '.claude', 'history.jsonl');
const STATS_PATH = path.join(os.homedir(), '.claude', 'stats-cache.json');
const CONFIG_PATH = path.join(__dirname, '..', 'usage-config.json');
const CURRENT_PROJECT = path.resolve(process.cwd());

function bar(ratio) {
  const safeRatio = Number.isFinite(ratio) ? Math.max(0, Math.min(ratio, 1)) : 0;
  const filled = Math.round(safeRatio * BAR_WIDTH);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, BAR_WIDTH - filled));
}

function fmtCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDateLocal(ts) {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatResetCountdown(targetTs, nowTs) {
  const diffMs = Math.max(0, targetTs - nowTs);
  const totalMinutes = Math.ceil(diffMs / (60 * 1000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `in ${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `in ${hours}h ${minutes}m`;
  }

  return `in ${minutes}m`;
}

function formatWeekdayTime(ts) {
  const d = new Date(ts);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdays[d.getDay()];
  const hours24 = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const suffix = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${weekday} ${hours12}:${minutes} ${suffix}`;
}

function parseIsoDate(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function nextWeeklyResetTs(nowTs, config) {
  const weeklyReset = config && config.weeklyReset;
  if (!weeklyReset || weeklyReset.type !== 'fixed') {
    return null;
  }

  const weekday = Number(weeklyReset.weekday);
  const hour = Number(weeklyReset.hour);
  const minute = Number(weeklyReset.minute);

  if (![0, 1, 2, 3, 4, 5, 6].includes(weekday) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const now = new Date(nowTs);
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);

  const dayDiff = (weekday - now.getDay() + 7) % 7;
  candidate.setDate(candidate.getDate() + dayDiff);

  if (candidate.getTime() <= nowTs) {
    candidate.setDate(candidate.getDate() + 7);
  }

  return candidate.getTime();
}

function startOfToday(now) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function readTailUtf8(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const length = size - start;
  const fd = fs.openSync(filePath, 'r');

  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    let text = buffer.toString('utf8');

    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }

    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function loadProjectHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return [];
  }

  const raw = readTailUtf8(HISTORY_PATH, MAX_HISTORY_BYTES);
  if (!raw.trim()) {
    return [];
  }

  const events = [];
  const seen = new Set();

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    if (!item || item.project !== CURRENT_PROJECT || !item.timestamp || !item.sessionId) {
      continue;
    }

    const key = `${item.timestamp}|${item.sessionId}|${item.display || ''}|${item.project}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    events.push(item);
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

function loadAllHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return [];
  }

  const raw = readTailUtf8(HISTORY_PATH, MAX_HISTORY_BYTES);
  if (!raw.trim()) {
    return [];
  }

  const events = [];
  const seen = new Set();

  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    if (!item || !item.timestamp || !item.sessionId) {
      continue;
    }

    const key = `${item.timestamp}|${item.sessionId}|${item.display || ''}|${item.project || ''}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    events.push(item);
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

function estimatePromptTokens(event) {
  const display = typeof event.display === 'string' ? event.display : '';
  const pastedText = event.pastedContents && Object.keys(event.pastedContents).length > 0
    ? JSON.stringify(event.pastedContents)
    : '';
  const chars = display.length + pastedText.length;
  const variableTokens = Math.ceil(chars / Math.max(CHARS_PER_TOKEN, 1));
  const baseTokens = display.startsWith('/') ? SLASH_COMMAND_BASE_TOKENS : BASE_PROMPT_TOKENS;
  return Math.max(baseTokens, baseTokens + variableTokens);
}

function estimateEventUsage(event, contextTokens) {
  const promptTokens = estimatePromptTokens(event);
  const contextMultiplier = 1 + Math.min(contextTokens / Math.max(CONTEXT_WINDOW_TOKENS, 1), 1.5) * CONTEXT_GROWTH_RATE;
  const replyTokens = Math.round(promptTokens * ASSISTANT_REPLY_MULTIPLIER);
  const totalTokens = Math.round((promptTokens + replyTokens) * contextMultiplier);
  const nextContextTokens = contextTokens + promptTokens + replyTokens;

  return {
    totalTokens,
    nextContextTokens,
  };
}

function estimateSequenceUsage(events) {
  let contextTokens = 0;
  let totalTokens = 0;

  for (const event of events) {
    const usage = estimateEventUsage(event, contextTokens);
    totalTokens += usage.totalTokens;
    contextTokens = usage.nextContextTokens;
  }

  return totalTokens;
}

function estimateWeeklyUsage(events) {
  const bySession = new Map();

  for (const event of events) {
    const items = bySession.get(event.sessionId) || [];
    items.push(event);
    bySession.set(event.sessionId, items);
  }

  let totalTokens = 0;
  for (const sessionEvents of bySession.values()) {
    totalTokens += estimateSequenceUsage(sessionEvents);
  }

  return totalTokens;
}

function readTokenInfo(todayStr) {
  if (!fs.existsSync(STATS_PATH)) {
    return null;
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
  } catch {
    return null;
  }

  const rows = Array.isArray(data.dailyModelTokens) ? data.dailyModelTokens : [];
  if (rows.length === 0) {
    return null;
  }

  const todayEntry = rows.find((item) => item.date === todayStr);
  const latestEntry = rows[rows.length - 1];
  const entry = todayEntry || latestEntry;

  if (!entry || !entry.tokensByModel) {
    return null;
  }

  const totalTokens = Object.values(entry.tokensByModel).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    totalTokens,
    isStale: entry.date !== todayStr,
  };
}

function readClaudeCredentialsFromKeychain() {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    return execFileSync(
      '/usr/bin/security',
      ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch {
    return null;
  }
}

function extractAccessToken(tokenJson) {
  if (!tokenJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(tokenJson);
    return parsed && parsed.claudeAiOauth && typeof parsed.claudeAiOauth.accessToken === 'string'
      ? parsed.claudeAiOauth.accessToken
      : null;
  } catch {
    return null;
  }
}

async function fetchOfficialUsage(accessToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), USAGE_API_TIMEOUT_MS);

  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data && typeof data === 'object' ? data : null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getOfficialUsage() {
  if (USAGE_MODE === 'estimate') {
    return null;
  }

  const tokenJson = readClaudeCredentialsFromKeychain();
  const accessToken = extractAccessToken(tokenJson);
  if (!accessToken) {
    if (USAGE_MODE === 'official') {
      throw new Error('无法从 macOS Keychain 读取 Claude access token');
    }
    return null;
  }

  try {
    return await fetchOfficialUsage(accessToken);
  } catch (error) {
    if (USAGE_MODE === 'official') {
      throw error;
    }
    return null;
  }
}

function buildOfficialOutput(usage, nowTs, tokenStr) {
  const fiveHour = usage && usage.five_hour && typeof usage.five_hour === 'object' ? usage.five_hour : null;
  const sevenDay = usage && usage.seven_day && typeof usage.seven_day === 'object' ? usage.seven_day : null;

  if (!fiveHour && !sevenDay) {
    return null;
  }

  const sessionPct = Math.round(Number(fiveHour && fiveHour.utilization) || 0);
  const weekPct = Math.round(Number(sevenDay && sevenDay.utilization) || 0);
  const sessionRatio = sessionPct / 100;
  const weekRatio = weekPct / 100;

  const fiveHourReset = parseIsoDate(fiveHour && fiveHour.resets_at);
  const sevenDayReset = parseIsoDate(sevenDay && sevenDay.resets_at);
  const sessionResetAt = fiveHourReset
    ? formatResetCountdown(fiveHourReset.getTime(), nowTs)
    : 'unknown';
  const weekResetAt = sevenDayReset
    ? formatWeekdayTime(sevenDayReset.getTime())
    : 'unknown';

  return `📊 sess ${bar(sessionRatio)} ${sessionPct}% reset ${sessionResetAt} | 7d ${bar(weekRatio)} ${weekPct}% reset ${weekResetAt}${tokenStr}`;
}

function buildEstimatedOutput(now, nowTs, config, tokenStr) {
  const todayStart = startOfToday(now);
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;
  const sessionStart = nowTs - 5 * 60 * 60 * 1000;
  const projectEvents = loadProjectHistory();
  const allEvents = loadAllHistory();

  if (projectEvents.length === 0 && allEvents.length === 0) {
    return '📊 当前项目暂无近实时记录';
  }

  const sessionEvents = allEvents.filter((item) => item.timestamp >= sessionStart);
  const weekEvents = allEvents.filter((item) => item.timestamp >= weekStart);
  const sessionUsage = estimateSequenceUsage(sessionEvents);
  const weekUsage = estimateWeeklyUsage(weekEvents);

  const sessionRatio = sessionUsage / CURRENT_SESSION_TOKEN_BUDGET;
  const weekRatio = weekUsage / WEEKLY_TOKEN_BUDGET;
  const sessionPct = Math.round(sessionRatio * 100);
  const weekPct = Math.round(weekRatio * 100);
  const sessionResetTs = sessionEvents.length > 0
    ? sessionEvents[0].timestamp + 5 * 60 * 60 * 1000
    : nowTs + 5 * 60 * 60 * 1000;
  const fixedWeekResetTs = nextWeeklyResetTs(nowTs, config);
  const weekResetTs = fixedWeekResetTs || (weekEvents.length > 0
    ? weekEvents[0].timestamp + 7 * 24 * 60 * 60 * 1000
    : nowTs + 7 * 24 * 60 * 60 * 1000);
  const sessionResetAt = formatResetCountdown(sessionResetTs, nowTs);
  const weekResetAt = fixedWeekResetTs
    ? formatWeekdayTime(weekResetTs)
    : formatResetCountdown(weekResetTs, nowTs);

  return `📊 est sess ${bar(sessionRatio)} ${sessionPct}% ${fmtCompact(sessionUsage)}/${fmtCompact(CURRENT_SESSION_TOKEN_BUDGET)} reset ${sessionResetAt} | 7d ${bar(weekRatio)} ${weekPct}% ${fmtCompact(weekUsage)}/${fmtCompact(WEEKLY_TOKEN_BUDGET)} reset ${weekResetAt}${tokenStr}`;
}

async function main() {
  const now = new Date();
  const nowTs = now.getTime();
  const todayStr = formatDateLocal(nowTs);
  const config = loadConfig();
  const tokenInfo = readTokenInfo(todayStr);
  const tokenStr = tokenInfo
    ? ` | tok ${fmtCompact(tokenInfo.totalTokens)}${tokenInfo.isStale ? '~' : ''}`
    : '';

  const officialUsage = await getOfficialUsage();
  const officialOutput = buildOfficialOutput(officialUsage, nowTs, tokenStr);
  if (officialOutput) {
    process.stdout.write(officialOutput);
    return;
  }

  process.stdout.write(buildEstimatedOutput(now, nowTs, config, tokenStr));
}

main().catch((error) => {
  process.stdout.write(`📊 usage unavailable: ${error.message}`);
});
