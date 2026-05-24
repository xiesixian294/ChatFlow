import {
  Loader2,
  Check,
  X,
  Wrench,
  CloudSun,
  Globe,
  Link as LinkIcon,
  Clock,
  Brain,
} from 'lucide-react'

import { cn } from '@/lib/utils'

/** 工具名 → 展示元信息。MCP 工具名形如 "tavily__tavily_search" */
function resolveMeta(name) {
  if (name === 'get_weather') return { label: '查询天气', Icon: CloudSun }
  if (name === 'get_current_time') return { label: '获取时间', Icon: Clock }
  if (/^memory__/.test(name)) {
    if (/search|read|open/i.test(name)) return { label: '检索记忆', Icon: Brain }
    return { label: '更新记忆', Icon: Brain }
  }
  if (/search$/i.test(name)) return { label: '联网搜索', Icon: Globe }
  if (/extract$/i.test(name)) return { label: '抓取网页', Icon: LinkIcon }
  if (/crawl$/i.test(name) || /map$/i.test(name)) {
    return { label: '站点检索', Icon: Globe }
  }
  if (/research$/i.test(name)) return { label: '深度研究', Icon: Globe }
  const pretty = name.includes('__') ? name.split('__').slice(1).join('__') : name
  return { label: pretty, Icon: Wrench }
}

/**
 * 详尽展示参数与结构化结果的工具白名单。
 * 其余工具（搜索/抓取/记忆/时间等中间过程类）只展示「图标 + 名称 + 状态」，
 * 避免把 query/原文等技术细节暴露给最终用户。
 */
const VERBOSE_TOOLS = new Set(['get_weather'])

function parseArgs(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function StatusIcon({ status }) {
  if (status === 'running') {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
  }
  if (status === 'failed') return <X className="size-3.5 text-destructive" />
  return <Check className="size-3.5 text-emerald-600" />
}

function WeatherView({ r }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
      <span className="text-muted-foreground">地点</span>
      <span>{[r.city, r.admin1, r.country].filter(Boolean).join('、')}</span>
      <span className="text-muted-foreground">天气</span>
      <span>{r.condition}</span>
      <span className="text-muted-foreground">温度</span>
      <span>
        {r.temperature_c}°C（体感 {r.feels_like_c}°C）
      </span>
      <span className="text-muted-foreground">湿度</span>
      <span>{r.humidity_percent}%</span>
      <span className="text-muted-foreground">风速</span>
      <span>{r.wind_speed_kmh} km/h</span>
      <span className="text-muted-foreground">观测时间</span>
      <span>{r.observed_at}</span>
    </div>
  )
}

function renderVerboseResult(name, result) {
  if (result == null) return null
  if (typeof result === 'object' && result.error) {
    return (
      <div className="text-muted-foreground">
        工具调用失败，AI 将根据情况给出回答。
      </div>
    )
  }
  if (name === 'get_weather') return <WeatherView r={result} />
  return (
    <pre className="whitespace-pre-wrap break-all text-[11.5px]">
      {JSON.stringify(result, null, 2)}
    </pre>
  )
}

export default function ToolCallCard({ name, arguments: argsJson, result, status }) {
  const meta = resolveMeta(name)
  const Icon = meta.Icon
  const verbose = VERBOSE_TOOLS.has(name)

  // 紧凑模式（搜索/抓取等中间工具）：仅图标 + 名称 + 状态
  if (!verbose) {
    return (
      <div
        className={cn(
          'my-1.5 inline-flex w-fit items-center gap-1.5 rounded-full border bg-background/80 px-2.5 py-1 text-xs text-muted-foreground',
          status === 'failed' && 'border-destructive/40 text-destructive'
        )}
      >
        <Icon className="size-3.5" />
        <span>{meta.label}</span>
        <StatusIcon status={status} />
      </div>
    )
  }

  // 详细模式（如天气）：保留参数 + 结构化结果
  const args = parseArgs(argsJson)
  return (
    <div
      className={cn(
        'my-2 rounded-md border bg-background/80 px-3 py-2 text-xs',
        status === 'failed' && 'border-destructive/40'
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        <Icon className="size-4" />
        <span>{meta.label}</span>
        <StatusIcon status={status} />
      </div>
      {Object.keys(args).length > 0 && (
        <div className="mt-1 text-muted-foreground">
          参数：
          {Object.entries(args)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
            .join('，')}
        </div>
      )}
      {result != null && (
        <div className="mt-1.5 rounded bg-muted/60 px-2 py-1.5">
          {renderVerboseResult(name, result)}
        </div>
      )}
    </div>
  )
}
