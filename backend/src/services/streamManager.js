/** 跟踪进行中的流式生成，供状态查询与手动取消 */
const active = new Map()

//注册流
export function registerStream(conversationId, controller) {
  //active是一个Map，key是会话id，value是AbortController
  //active.set(Number(conversationId), controller)将会话id和AbortController关联起来
  active.set(Number(conversationId), controller)
}

//取消流 传入会话id，返回是否取消成功
export function cancelStream(conversationId) {
  //active.get(Number(conversationId))获取会话id对应的AbortController
  const controller = active.get(Number(conversationId))
  if (!controller) return false
  controller.abort()
  active.delete(Number(conversationId))
  return true
}

//判断会话是否正在生成
export function isStreaming(conversationId) {
  return active.has(Number(conversationId))
}

//结束流
export function endStream(conversationId) {
  active.delete(Number(conversationId))
}
