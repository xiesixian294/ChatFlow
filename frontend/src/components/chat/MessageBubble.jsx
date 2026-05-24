import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileText } from 'lucide-react'

import { cn } from '@/lib/utils'
import { normalizeMarkdown } from '@/lib/markdown'
import ToolCallCard from '@/components/chat/ToolCallCard'

function extractUserQuestion(content) {
  const marker = '【用户问题】\n'
  const idx = content.indexOf(marker)
  if (idx >= 0) return content.slice(idx + marker.length)
  return content
}

/**
 * 过滤掉「同名工具后续有成功调用」的失败重试，避免给用户看到 AI 试错过程。
 * 仅展示有意义的进展：所有成功 + 真正最终失败（同名全部失败）的调用。
 */
function dedupeToolCalls(calls) {
  if (!Array.isArray(calls) || calls.length === 0) return calls
  const successNames = new Set()
  for (const c of calls) {
    if (c.status === 'done') successNames.add(c.name)
  }
  return calls.filter(
    (c) => c.status !== 'failed' || !successNames.has(c.name)
  )
}

const markdownComponents = {
  // 段落与基础元素
  p: ({ node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  ul: ({ node, ...props }) => <ul className="my-2 ml-5 list-disc space-y-1" {...props} />,
  ol: ({ node, ...props }) => <ol className="my-2 ml-5 list-decimal space-y-1" {...props} />,
  li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
  h1: ({ node, ...props }) => <h1 className="mt-4 mb-2 text-lg font-semibold" {...props} />,
  h2: ({ node, ...props }) => <h2 className="mt-4 mb-2 text-base font-semibold" {...props} />,
  h3: ({ node, ...props }) => <h3 className="mt-3 mb-1.5 text-sm font-semibold" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote
      className="my-2 border-l-2 border-border pl-3 text-muted-foreground"
      {...props}
    />
  ),
  a: ({ node, ...props }) => (
    <a
      className="text-primary underline underline-offset-2 hover:opacity-80"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    />
  ),
  hr: () => <hr className="my-3 border-border" />,

  // 表格
  table: ({ node, ...props }) => (
    <div className="my-3 overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  thead: ({ node, ...props }) => <thead className="bg-muted/60" {...props} />,
  tbody: ({ node, ...props }) => <tbody {...props} />,
  tr: ({ node, ...props }) => <tr className="border-b border-border last:border-0" {...props} />,
  th: ({ node, ...props }) => (
    <th
      className="border-r border-border px-3 py-2 text-left font-medium last:border-0"
      {...props}
    />
  ),
  td: ({ node, ...props }) => (
    <td
      className="border-r border-border px-3 py-2 align-top last:border-0"
      {...props}
    />
  ),

  // 代码（行内 vs 围栏）
  code: ({ inline, className, children, ...props }) => {
    if (inline) {
      return (
        <code
          className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono"
          {...props}
        >
          {children}
        </code>
      )
    }
    return (
      <code className={cn('font-mono text-xs', className)} {...props}>
        {children}
      </code>
    )
  },
  pre: ({ node, ...props }) => (
    <pre
      className="my-2 overflow-x-auto rounded-md bg-foreground/5 p-3 text-xs leading-relaxed"
      {...props}
    />
  ),
}

export default function MessageBubble({
  role,
  content,
  attachments = [],
  toolCalls = null,
}) {
  const isUser = role === 'user'
  const displayContent = isUser ? extractUserQuestion(content) : content

  const normalized = useMemo(
    () => (isUser ? displayContent : normalizeMarkdown(displayContent || '')),
    [isUser, displayContent]
  )

  const visibleToolCalls = useMemo(
    () => (!isUser ? dedupeToolCalls(toolCalls) : null),
    [isUser, toolCalls]
  )
  const hasToolCalls = !isUser && Array.isArray(visibleToolCalls) && visibleToolCalls.length > 0

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="size-8 shrink-0 rounded-full bg-foreground text-background text-xs flex items-center justify-center">
          AI
        </div>
      )}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words',
          isUser
            ? 'bg-foreground text-background'
            : 'bg-muted text-foreground'
        )}
      >
        {isUser && attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-background/20">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-md bg-background/15 px-2 py-0.5 text-xs"
              >
                <FileText className="size-3" />
                {a.originalName}
              </span>
            ))}
          </div>
        )}
        {isUser ? (
          <div className="whitespace-pre-wrap">{displayContent}</div>
        ) : (
          <div className="max-w-none">
            {hasToolCalls && (
              <div className="space-y-1.5">
                {visibleToolCalls.map((t) => (
                  <ToolCallCard key={t.id} {...t} />
                ))}
              </div>
            )}
            {!content && !hasToolCalls && (
              <span className="text-muted-foreground animate-pulse">
                正在输入…
              </span>
            )}
            {content && (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {normalized}
              </ReactMarkdown>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
