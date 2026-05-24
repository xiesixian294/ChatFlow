/**
 * 时间工具：返回当前精确日期时间。
 *
 * 为什么不用 MCP？
 *   进程内 new Date() 一行可得，起子进程纯属过度工程。
 *   遵循 PROJECT_RULES §3.7：简单能力本地实现，复杂能力走 MCP。
 *
 * 用法（LLM 视角）：
 *   - 用户提及「今天」「现在」「最近」「本周」等时间词时调用
 *   - 不传 timezone 默认 Asia/Shanghai
 */

const DEFAULT_TIMEZONE = 'Asia/Shanghai'
const WEEKDAY_MAP = {
  Sun: '星期日', Mon: '星期一', Tue: '星期二', Wed: '星期三',
  Thu: '星期四', Fri: '星期五', Sat: '星期六',
}

function isValidTimezone(tz) {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

export async function getCurrentTime({ timezone } = {}) {
  const tz = isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE
  const now = new Date()

  // en-CA 输出 YYYY-MM-DD；sv-SE 输出 HH:mm:ss（24h）
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  const time = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now)
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short',
  }).format(now)

  return {
    datetime: `${date} ${time}`,
    date,
    time,
    timezone: tz,
    weekday: WEEKDAY_MAP[weekdayShort] || weekdayShort,
    iso: now.toISOString(),
    unix: Math.floor(now.getTime() / 1000),
    ...(timezone && tz !== timezone
      ? { timezone_fallback: `无效时区 ${timezone}，已回退到 ${tz}` }
      : {}),
  }
}
