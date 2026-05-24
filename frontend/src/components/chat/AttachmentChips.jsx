import { FileText, X, Loader2, AlertCircle, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function AttachmentChips({ attachments, onRemove, onRetry }) {
  if (!attachments.length) return null

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {attachments.map((a) => (
        <div
          key={a.localId}
          className={cn(
            'flex flex-col gap-1 rounded-lg border px-2.5 py-1.5 text-xs max-w-full min-w-[140px]',
            a.status === 'failed'
              ? 'border-destructive/50 bg-destructive/5 text-destructive'
              : 'bg-muted/50 text-foreground'
          )}
        >
          <div className="flex items-center gap-1.5">
            {a.status === 'uploading' || a.status === 'parsing' ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
            ) : a.status === 'failed' ? (
              <AlertCircle className="size-3.5 shrink-0" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate max-w-[160px] flex-1" title={a.name}>
              {a.name}
            </span>
            {a.status === 'failed' && onRetry && a.file && (
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                title="重试上传"
                onClick={() => onRetry(a.localId)}
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(a.localId)}
              disabled={a.status === 'uploading'}
            >
              <X className="size-3.5" />
            </button>
          </div>
          {a.status === 'uploading' && a.progress != null && (
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-200"
                style={{ width: `${Math.round(a.progress * 100)}%` }}
              />
            </div>
          )}
          {a.status === 'ready' && a.charCount != null && (
            <span className="text-muted-foreground">
              {(a.charCount / 1000).toFixed(1)}k 字
            </span>
          )}
          {a.status === 'failed' && (
            <span className="truncate text-[11px]" title={a.error}>
              {a.error || '上传失败'}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
