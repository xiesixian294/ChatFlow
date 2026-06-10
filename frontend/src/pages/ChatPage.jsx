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

//默认会话状态，每一个会话都有一个默认状态
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
      const patch = typeof updater === 'function' ? updater(current) : updater
      // 函数式 updater 与对象 updater 一律按「局部补丁」合并进 current，
      // 避免只返回部分字段时把 messages/input 等其它字段丢成 undefined。
      const next = { ...current, ...patch }
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

  //用户点击停止按钮的时候会触发这个函数
  async function handleStop() {
    if (!activeId) return
    await api
      //发送取消请求
      .post('/chat/cancel', { conversationId: activeId })
      .catch(() => { })
    //取消请求
    streamRefs.current.get(activeId)?.abort()
    //删除流引用
    streamRefs.current.delete(activeId)
    //更新会话状态为发送完成
    updateConvState(activeId, { sending: false })
    //停止轮询
    stopPolling(activeId)
    //加载会话消息
    await loadMessages(activeId)
  }

  //用户点击发送按钮的时候会触发这个函数
  async function handleSend() {
    const content = input.trim()
    //过滤出所有状态为ready的附件
    const readyAttachments = attachments.filter((a) => a.status === 'ready')
    //过滤出所有状态为uploading或parsing的附件
    const hasPending = attachments.some(
      (a) => a.status === 'uploading' || a.status === 'parsing'
    )

    //如果正在发送或者有未完成的附件，则返回
    if (sending || hasPending) return
    //如果输入内容为空且没有ready附件，则返回
    if (!content && !readyAttachments.length) return

    //获取当前会话id
    let convId = activeId
    //获取当前会话的聊天记录
    //最初是默认状态，每一个id都有自己的状态，通过getConvState(convStateRef.current, convId)获取
    const convMessages = getConvState(convStateRef.current, convId).messages
    //判断是否是第一次发送消息
    const isFirstMessage = convMessages.length === 0

    //当前会话id不存在，则创建一个新会话
    if (!convId) {
      //truncateTitle(content)截取内容的前30个字符作为标题
      //发送新建会话请求
      const { data } = await api.post('/conversations', {
        title: truncateTitle(content),
      })
      //新建对话的响应数据里面会有会话id
      convId = data.id
      //设置当前会话id
      setActiveId(convId)
      //更新会话状态，会话状态里面有messages，input，attachments，sending，webSearchEnabled
      updateConvState(convId, DEFAULT_CONV_STATE)
      //加载会话列表
      await loadConversations()//获取会话列表
    }

    //如果当前会话是第一次发送消息，则更新本地会话标题
    if (isFirstMessage) {
      updateLocalTitle(convId, content || readyAttachments[0]?.name || '新对话')
    }

    //获取所有ready附件的fileId
    const attachmentIds = readyAttachments.map((a) => a.fileId)
    //获取所有ready附件的显示信息
    const displayAttachments = readyAttachments.map((a) => ({
      id: a.fileId,
      originalName: a.name,
      charCount: a.charCount,
    }))
    const useWebSearch = getConvState(convStateRef.current, convId).webSearchEnabled

    //基础准备做完了，我们开始发消息，我们先更新一下会话状态
    //更新会话状态
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

    //创建一个AbortController，用于取消请求
    const controller = new AbortController()
    //streamRefs是一个Map，key是会话id，value是AbortController
    //streamRefs.current.set(convId, controller)将会话id和AbortController关联起来
    streamRefs.current.set(convId, controller)

    //构建SSE请求的URL
    //conversationId是会话id，content是用户输入的内容，useWebSearch是是否启用联网搜索，attachmentIds是附件id
    //如果启用联网搜索，则添加webSearch=1
    //如果附件id不为空，则添加attachmentIds=附件id
    let url = `/api/chat/stream?conversationId=${convId}&content=${encodeURIComponent(content)}`
    if (useWebSearch) {
      url += '&webSearch=1'
    }
    if (attachmentIds.length) {
      url += `&attachmentIds=${attachmentIds.join(',')}`
    }

    //发送请求同时使用try...catch...finally处理请求的异常
    try {
      //发送请求
      await streamSSE({
        url,
        token,
        signal: controller.signal,
        //streamSSE从长连接当中没解析出一个SSE事件，就调用一次这个回调函数onEvent
        //后端每解析出一个delta 就用send函数发过来，前端就触发一次这个回调函数onEvent
        //event是事件类型，data是事件数据
        onEvent: (event, data) => {
          //updataConvState根据convID来更新会话
          updateConvState(convId, (s) => ({
            //修改message，applyStreamEvent函数在原来的message基础上添加一个
            messages: applyStreamEvent(s.messages, event, data),
          }))
        },
      })
      await loadMessages(convId)//加载会话消息
      await loadConversations()//加载会话列表
    } catch (err) {
      if (err.name === 'AbortError') {
        await loadMessages(convId)//加载会话消息
      } else if (String(err.message).includes('409')) {
        startPolling(convId)//重新开始轮询
      } else {
        console.error(err)//记录错误日志
        toast.error(err.message || '消息发送失败')
        await loadMessages(convId)//加载会话消息
      }
    } finally {
      streamRefs.current.delete(convId)//删除流引用
      if (!pollTimersRef.current.has(convId)) {
        updateConvState(convId, { sending: false })//更新会话状态为发送完成 
      }//如果轮询器没有正在轮询，则更新会话状态为发送完成 
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

