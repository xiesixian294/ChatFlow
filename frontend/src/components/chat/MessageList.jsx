import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import MessageBubble from '@/components/chat/MessageBubble'

const ESTIMATE_SIZE = 120
const GAP = 24
const STICKY_BOTTOM_THRESHOLD = 150

export default function MessageList({ messages, sending }) {
  const scrollRef = useRef(null)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATE_SIZE,
    overscan: 8,
    gap: GAP,
  })

  // 切换会话或新增消息时滚到底部
  useEffect(() => {
    if (!messages.length) return
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    })
  }, [messages.length, virtualizer])

  // 流式输出时，若用户已在底部附近则保持跟随
  const lastContent = messages[messages.length - 1]?.content
  useEffect(() => {
    if (!sending || !messages.length) return
    const el = scrollRef.current
    if (!el) return
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < STICKY_BOTTOM_THRESHOLD
    if (nearBottom) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
  }, [lastContent, sending, messages.length, virtualizer])

  if (messages.length === 0) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="text-center text-muted-foreground mt-32">
            <h2 className="text-2xl font-medium text-foreground">
              有什么可以帮你的吗？
            </h2>
            <p className="mt-2 text-sm">在下方输入消息开始对话</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div
        className="max-w-3xl mx-auto px-6 py-8 relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const m = messages[virtualItem.index]
          return (
            <div
              key={m.id}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full box-border"
              style={{ transform: `translateY(${virtualItem.start}px)` }}
            >
              <MessageBubble
                role={m.role}
                content={m.content}
                attachments={m.attachments}
                toolCalls={m.toolCalls}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
