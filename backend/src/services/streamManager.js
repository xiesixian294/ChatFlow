/** 跟踪进行中的流式生成，供状态查询与手动取消 */
const active = new Map()

export function registerStream(conversationId, controller) {
  active.set(Number(conversationId), controller)
}

export function cancelStream(conversationId) {
  const controller = active.get(Number(conversationId))
  if (!controller) return false
  controller.abort()
  active.delete(Number(conversationId))
  return true
}

export function isStreaming(conversationId) {
  return active.has(Number(conversationId))
}

export function endStream(conversationId) {
  active.delete(Number(conversationId))
}
