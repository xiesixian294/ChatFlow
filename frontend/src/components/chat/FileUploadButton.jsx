import { useRef } from 'react'
import { Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FILE_ACCEPT } from '@/lib/files'

export default function FileUploadButton({ onSelect, disabled, maxReached }) {
  const inputRef = useRef(null)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={FILE_ACCEPT}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onSelect(file)
          e.target.value = ''
        }}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="shrink-0"
        disabled={disabled || maxReached}
        title={maxReached ? '已达附件上限' : '上传文件'}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip />
      </Button>
    </>
  )
}
