import { Plus, MessageSquare, Trash2, LogOut, Loader2 } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { logout } from '@/store/authSlice'

export default function Sidebar({
  conversations,
  activeId,
  streamingIds = [],
  onSelect,
  onCreate,
  onDelete,
}) {
  const user = useSelector((s) => s.auth.user)
  const dispatch = useDispatch()
  const navigate = useNavigate()

  function handleLogout() {
    dispatch(logout())
    navigate('/login')
  }

  return (
    <aside className="w-64 shrink-0 border-r bg-muted/30 flex flex-col">
      <div className="p-3">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={onCreate}
        >
          <Plus />
          新建对话
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
        {conversations.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            还没有对话
          </div>
        )}
        {conversations.map((c) => {
          const isStreaming = streamingIds.includes(c.id)
          return (
          <div
            key={c.id}
            className={cn(
              'group flex items-center gap-2 rounded-md px-2.5 py-2 text-sm cursor-pointer transition-colors',
              activeId === c.id
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/60'
            )}
            onClick={() => onSelect(c.id)}
          >
            {isStreaming ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            ) : (
              <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="flex-1 truncate">{c.title}</span>
            <button
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(c.id)
              }}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
          )
        })}
      </div>

      <div className="border-t p-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground truncate">
          {user?.username || '游客'}
        </span>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
          title="退出登录"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  )
}
