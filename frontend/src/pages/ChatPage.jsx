import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useSelector } from 'react-redux'
import { toast } from 'sonner'

import api from '@/lib/api'
import { streamSSE } from '@/lib/sse'
import {
  uploadFile,
  pollFileUntilReady,
  deleteFile,
  isAllowedFile,
  MAX_ATTACHMENTS,
} from '@/lib/files'
import Sidebar from '@/components/chat/Sidebar'
import MessageList from '@/components/chat/MessageList'
import ChatInput from '@/components/chat/ChatInput'

const TITLE_MAX = 30

const DEFAULT_CONV_STATE = {
  messages: [],
  sending: false,
  input: '',
  attachments: [],
  webSearchEnabled: false,
}

function truncateTitle(text) {
  return text.trim().slice(0, TITLE_MAX) || '新对话'
}

function getConvState(map, convId) {
  if (!convId) return DEFAULT_CONV_STATE
  return map[convId] ?? DEFAULT_CONV_STATE
}

function applyStreamEvent(messages, event, data) {
  const next = [...messages]
  const last = next[next.length - 1]
  if (!last || last.role !== 'assistant') return messages

  if (event === 'delta') {
    next[next.length - 1] = {
      ...last,
      content: last.content + (data.content || ''),
    }
  } else if (event === 'tool_call') {
    const toolCalls = [...(last.toolCalls || []), { ...data }]
    next[next.length - 1] = { ...last, toolCalls }
  } else if (event === 'tool_result') {
    const toolCalls = (last.toolCalls || []).map((t) =>
      t.id === data.id ? { ...t, ...data } : t
    )
    next[next.length - 1] = { ...last, toolCalls }
  } else if (event === 'error') {
    next[next.length - 1] = {
      ...last,
      content: `出错了：${data.message}`,
    }
  }
  return next
}

export default function ChatPage() {
  const token = useSelector((s) => s.auth.token)

  const [conversations, setConversations] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [convState, setConvState] = useState({})

  const convStateRef = useRef({})
  const streamRefs = useRef(new Map())
  const pollTimersRef = useRef(new Map())
  const workerRef = useRef(null)

  const updateConvState = useCallback((convId, updater) => {
    if (!convId) return
    setConvState((prev) => {
      const current = prev[convId] ?? DEFAULT_CONV_STATE
      const next =
        typeof updater === 'function'
          ? updater(current)
          : { ...current, ...updater }
      const updated = { ...prev, [convId]: next }
      convStateRef.current = updated
      return updated
    })
  }, [])

  const activeState = getConvState(convState, activeId)
  const { messages, sending, input, attachments, webSearchEnabled } = activeState

  const streamingIds = useMemo(
    () =>
      Object.entries(convState)
        .filter(([, s]) => s.sending)
        .map(([id]) => Number(id)),
    [convState]
  )

  const loadConversations = useCallback(async () => {
    const { data } = await api.get('/conversations')
    setConversations(data.list)
    return data.list
  }, [])

  const loadMessages = useCallback(
    async (convId) => {
      const { data } = await api.get(`/conversations/${convId}/messages`)
      updateConvState(convId, { messages: data.list })
      return data.list
    },
    [updateConvState]
  )

  const visibleConversations = useMemo(() => {
    let seenEmpty = false
    return conversations.filter((c) => {
      if (Number(c.message_count) === 0) {
        if (seenEmpty) return false
        seenEmpty = true
      }
      return true
    })
  }, [conversations])

  const updateLocalTitle = useCallback((convId, content) => {
    const title = truncateTitle(content)
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title } : c))
    )
  }, [])

  const stopPolling = useCallback((convId) => {
    if (convId != null) {
      const timer = pollTimersRef.current.get(convId)
      if (timer) {
        clearInterval(timer)
        pollTimersRef.current.delete(convId)
      }
      return
    }
    for (const timer of pollTimersRef.current.values()) {
      clearInterval(timer)
    }
    pollTimersRef.current.clear()
  }, [])

  const startPolling = useCallback(
    (convId) => {
      if (pollTimersRef.current.has(convId)) return

      pollTimersRef.current.set(
        convId,
        setInterval(async () => {
          try {
            const { data: status } = await api.get('/chat/status', {
              params: { conversationId: convId },
            })
            await loadMessages(convId)
            if (!status.streaming) {
              updateConvState(convId, { sending: false })
              stopPolling(convId)
              await loadConversations()
            }
          } catch (err) {
            console.error(err)
          }
        }, 800)
      )
    },
    [loadMessages, loadConversations, stopPolling, updateConvState]
  )

  useEffect(() => {
    loadConversations().then((list) => {
      if (list.length) setActiveId((prev) => prev ?? list[0].id)
    })
    return () => {
      stopPolling()
      for (const controller of streamRefs.current.values()) {
        controller.abort()
      }
      streamRefs.current.clear()
    }
  }, [loadConversations, stopPolling])

  useEffect(() => {
    if (!activeId) return

    let cancelled = false

    async function initConversation() {
      const hasLocalStream = streamRefs.current.has(activeId)

      if (!hasLocalStream) {
        await loadMessages(activeId)
      }
      if (cancelled) return

      try {
        const { data: status } = await api.get('/chat/status', {
          params: { conversationId: activeId },
        })
        if (cancelled) return

        if (status.streaming) {
          updateConvState(activeId, { sending: true })
          if (!hasLocalStream) startPolling(activeId)
        } else {
          updateConvState(activeId, { sending: false })
          stopPolling(activeId)
        }
      } catch {
        if (!cancelled) updateConvState(activeId, { sending: false })
      }
    }

    initConversation()
    return () => {
      cancelled = true
    }
  }, [
    activeId,
    loadMessages,
    startPolling,
    stopPolling,
    updateConvState,
  ])

  function cleanupConversation(convId) {
    streamRefs.current.get(convId)?.abort()
    streamRefs.current.delete(convId)
    stopPolling(convId)
    setConvState((prev) => {
      const next = { ...prev }
      delete next[convId]
      convStateRef.current = next
      return next
    })
  }

  async function handleCreate() {
    const list = conversations.length ? conversations : await loadConversations()
    const empty = list.find((c) => Number(c.message_count) === 0)
    if (empty) {
      setActiveId(empty.id)
      updateConvState(empty.id, { messages: [] })
      return
    }

    const { data } = await api.post('/conversations', { title: '新对话' })
    await loadConversations()
    setActiveId(data.id)
    updateConvState(data.id, DEFAULT_CONV_STATE)
  }

  async function handleDelete(id) {
    cleanupConversation(id)
    await api.delete(`/conversations/${id}`)
    const wasActive = activeId === id
    const list = await loadConversations()
    if (wasActive) {
      setActiveId(list.length ? list[0].id : null)
    }
  }

  function previewTextFile(file) {
    return new Promise((resolve) => {
      try {
        if (!workerRef.current) {
          workerRef.current = new Worker(
            new URL('../workers/textFileParser.worker.js', import.meta.url)
          )
        }
        const worker = workerRef.current
        const onMessage = (e) => {
          worker.removeEventListener('message', onMessage)
          resolve(e.data)
        }
        worker.addEventListener('message', onMessage)
        worker.postMessage({ file })
      } catch {
        resolve({ ok: false })
      }
    })
  }

  async function runFileUpload(convId, localId, file) {
    updateConvState(convId, (s) => ({
      attachments: s.attachments.map((a) =>
        a.localId === localId
          ? { ...a, status: 'uploading', progress: 0, error: null, file }
          : a
      ),
    }))

    try {
      const uploaded = await uploadFile(file, convId, {
        onProgress: (p) => {
          updateConvState(convId, (s) => ({
            attachments: s.attachments.map((a) =>
              a.localId === localId ? { ...a, progress: p } : a
            ),
          }))
        },
      })

      updateConvState(convId, (s) => ({
        attachments: s.attachments.map((a) =>
          a.localId === localId
            ? { ...a, status: 'parsing', progress: 1 }
            : a
        ),
      }))

      const ready = await pollFileUntilReady(uploaded.id)

      updateConvState(convId, (s) => ({
        attachments: s.attachments.map((a) =>
          a.localId === localId
            ? {
              ...a,
              fileId: ready.id,
              status: 'ready',
              charCount: ready.charCount,
              name: ready.originalName,
              progress: 1,
            }
            : a
        ),
      }))
    } catch (err) {
      updateConvState(convId, (s) => ({
        attachments: s.attachments.map((a) =>
          a.localId === localId
            ? {
              ...a,
              status: 'failed',
              file,
              error: err.response?.data?.message || err.message,
            }
            : a
        ),
      }))
    }
  }

  async function handleSelectFile(file) {
    if (!activeId) return
    if (!isAllowedFile(file)) {
      toast.error('不支持的文件类型')
      return
    }
    if (attachments.length >= MAX_ATTACHMENTS) {
      toast.warning(`每条消息最多 ${MAX_ATTACHMENTS} 个附件`)
      return
    }

    const localId = `local-${Date.now()}`
    updateConvState(activeId, (s) => ({
      attachments: [
        ...s.attachments,
        {
          localId,
          name: file.name,
          file,
          status: 'uploading',
          progress: 0,
          charCount: null,
        },
      ],
    }))

    const textExts = /(\.txt|\.md|\.json|\.csv|\.jsx?|\.tsx?|\.py|\.java|\.go|\.rs|\.html|\.css|\.scss|\.sql|\.sh|\.ya?ml|\.xml|\.vue|\.php|\.rb|\.c|\.cpp|\.h|\.cs)$/i
    if (textExts.test(file.name)) {
      const preview = await previewTextFile(file)
      if (preview.ok) {
        updateConvState(activeId, (s) => ({
          attachments: s.attachments.map((a) =>
            a.localId === localId
              ? {
                ...a,
                charCount: preview.charCount,
                clientPreview: preview.preview,
              }
              : a
          ),
        }))
      }
    }

    await runFileUpload(activeId, localId, file)
  }

  async function handleRetryAttachment(localId) {
    if (!activeId) return
    const item = attachments.find((a) => a.localId === localId)
    if (!item?.file) return
    await runFileUpload(activeId, localId, item.file)
  }

  async function handleRemoveAttachment(localId) {
    if (!activeId) return
    const item = attachments.find((a) => a.localId === localId)
    updateConvState(activeId, (s) => ({
      attachments: s.attachments.filter((a) => a.localId !== localId),
    }))
    if (item?.fileId) {
      await deleteFile(item.fileId).catch(() => { })
    }
  }

  async function handleStop() {
    if (!activeId) return
    await api
      .post('/chat/cancel', { conversationId: activeId })
      .catch(() => { })
    streamRefs.current.get(activeId)?.abort()
    streamRefs.current.delete(activeId)
    updateConvState(activeId, { sending: false })
    stopPolling(activeId)
    await loadMessages(activeId)
  }

  async function handleSend() {
    const content = input.trim()
    const readyAttachments = attachments.filter((a) => a.status === 'ready')
    const hasPending = attachments.some(
      (a) => a.status === 'uploading' || a.status === 'parsing'
    )

    if (sending || hasPending) return
    if (!content && !readyAttachments.length) return

    let convId = activeId
    const convMessages = getConvState(convStateRef.current, convId).messages
    const isFirstMessage = convMessages.length === 0

    if (!convId) {
      const { data } = await api.post('/conversations', {
        title: truncateTitle(content),
      })
      convId = data.id
      setActiveId(convId)
      updateConvState(convId, DEFAULT_CONV_STATE)
      await loadConversations()
    } else if (isFirstMessage) {
      updateLocalTitle(
        convId,
        content || readyAttachments[0]?.name || '新对话'
      )
    }

    const attachmentIds = readyAttachments.map((a) => a.fileId)
    const displayAttachments = readyAttachments.map((a) => ({
      id: a.fileId,
      originalName: a.name,
      charCount: a.charCount,
    }))
    const useWebSearch = getConvState(convStateRef.current, convId).webSearchEnabled

    updateConvState(convId, {
      input: '',
      attachments: [],
      sending: true,
      messages: [
        ...convMessages,
        {
          id: `tmp-u-${Date.now()}`,
          role: 'user',
          content: content || '请根据附件内容回答。',
          attachments: displayAttachments,
        },
        { id: `tmp-a-${Date.now()}`, role: 'assistant', content: '' },
      ],
    })

    const controller = new AbortController()
    streamRefs.current.set(convId, controller)

    let url = `/api/chat/stream?conversationId=${convId}&content=${encodeURIComponent(content)}`
    if (useWebSearch) {
      url += '&webSearch=1'
    }
    if (attachmentIds.length) {
      url += `&attachmentIds=${attachmentIds.join(',')}`
    }

    try {
      await streamSSE({
        url,
        token,
        signal: controller.signal,
        onEvent: (event, data) => {
          updateConvState(convId, (s) => ({
            messages: applyStreamEvent(s.messages, event, data),
          }))
        },
      })
      await loadMessages(convId)
      await loadConversations()
    } catch (err) {
      if (err.name === 'AbortError') {
        await loadMessages(convId)
      } else if (String(err.message).includes('409')) {
        startPolling(convId)
      } else {
        console.error(err)
        toast.error(err.message || '消息发送失败')
        await loadMessages(convId)
      }
    } finally {
      streamRefs.current.delete(convId)
      if (!pollTimersRef.current.has(convId)) {
        updateConvState(convId, { sending: false })
      }
    }
  }

  return (
    <div className="h-screen flex bg-background text-foreground">
      <Sidebar
        conversations={visibleConversations}
        activeId={activeId}
        streamingIds={streamingIds}
        onSelect={setActiveId}
        onCreate={handleCreate}
        onDelete={handleDelete}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b flex items-center px-6 text-sm font-medium">
          {conversations.find((c) => c.id === activeId)?.title || 'React AI'}
        </header>

        <MessageList
          key={activeId ?? 'new'}
          messages={messages}
          sending={sending}
        />

        <div className="border-t bg-background">
          <div className="max-w-3xl mx-auto px-6 py-4">
            <ChatInput
              key={activeId ?? 'new'}
              value={input}
              onChange={(v) => activeId && updateConvState(activeId, { input: v })}
              onSend={handleSend}
              onStop={handleStop}
              sending={sending}
              webSearchEnabled={webSearchEnabled}
              onWebSearchChange={(enabled) =>
                activeId && updateConvState(activeId, { webSearchEnabled: enabled })
              }
              attachments={attachments}
              onRemoveAttachment={handleRemoveAttachment}
              onRetryAttachment={handleRetryAttachment}
              onSelectFile={handleSelectFile}
            />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              内容由 AI 生成，请甄别准确性
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
