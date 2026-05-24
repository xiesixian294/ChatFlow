/**
 * Tool 分发器：根据 LLM 返回的 tool_calls 路由到本地 handler 或 MCP Client。
 * 统一提供超时与异常隔离：handler 抛错不会让整个流崩。
 */
import { localHandlers } from './tools/registry.js'
import { isMcpTool, callMcpTool } from './mcp/client.js'

const TOOL_TIMEOUT_MS = 30000

function withTimeout(parentSignal, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  const onAbort = () => ctrl.abort()
  parentSignal?.addEventListener?.('abort', onAbort, { once: true })
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener?.('abort', onAbort)
    },
  }
}

/**
 * @param {{ name: string, arguments: string }} call - LLM 累积后的 tool_call
 * @param {{ signal?: AbortSignal }} ctx
 * @returns {Promise<{ result?: any, error?: string }>}
 */
export async function dispatchToolCall({ name, arguments: argsJson }, { signal } = {}) {
  let args
  try {
    args = JSON.parse(argsJson || '{}')
  } catch {
    return { error: `参数 JSON 解析失败: ${argsJson}` }
  }

  const isLocal = !!localHandlers[name]
  const isMcp = isMcpTool(name)
  if (!isLocal && !isMcp) return { error: `未知工具: ${name}` }

  const { signal: scoped, cleanup } = withTimeout(signal, TOOL_TIMEOUT_MS)
  try {
    const result = isLocal
      ? await localHandlers[name](args, { signal: scoped })
      : await callMcpTool(name, args, { signal: scoped })
    return { result }
  } catch (err) {
    if (err.name === 'AbortError') return { error: `工具超时（>${TOOL_TIMEOUT_MS}ms）或被取消` }
    return { error: err.message || String(err) }
  } finally {
    cleanup()
  }
}
