import { useRef, useEffect } from 'react'
import { ArrowUp, Square } from 'lucide-react'

import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import FileUploadButton from '@/components/chat/FileUploadButton'
import AttachmentChips from '@/components/chat/AttachmentChips'
import { MAX_ATTACHMENTS } from '@/lib/files'

export default function ChatInput({
  value,
  onChange,
  onSend,
  onStop,
  sending,
  attachments,
  onRemoveAttachment,
  onRetryAttachment,
  onSelectFile,
}) {
  const ref = useRef(null)

  const hasPending = attachments.some(
    (a) => a.status === 'uploading' || a.status === 'parsing'
  )
  const hasReady = attachments.some((a) => a.status === 'ready')
  const canSend =
    !sending &&
    !hasPending &&
    (value.trim() || hasReady)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [value])

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  return (
    <div>
      <AttachmentChips
        attachments={attachments}
        onRemove={onRemoveAttachment}
        onRetry={onRetryAttachment}
      />
      <div className="relative rounded-2xl border bg-background shadow-sm focus-within:ring-1 focus-within:ring-ring transition">
        <div className="flex items-end gap-1 pl-2 pb-2">
          <FileUploadButton
            onSelect={onSelectFile}
            disabled={sending}
            maxReached={attachments.length >= MAX_ATTACHMENTS}
          />
          <Textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="发送消息，可上传 txt / md / pdf / docx / 代码等"
            className="border-0 shadow-none focus-visible:ring-0 px-2 py-3 flex-1 max-h-[200px] min-h-[44px] resize-none"
          />
          <div className="pr-2 pb-1">
            {sending ? (
              <Button size="icon" variant="secondary" onClick={onStop}>
                <Square />
              </Button>
            ) : (
              <Button size="icon" onClick={onSend} disabled={!canSend}>
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
