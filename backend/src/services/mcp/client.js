/**
 * MCP Client 管理器
 *
 * 职责：
 * 1) 进程启动时根据 mcp.config.json 拉起所有 enabled 的 MCP Server（子进程，stdio）
 * 2) 拉取每个 server 的 tools/list，转换为 OpenAI Tool Calling Schema
 * 3) LLM 触发 tool_calls 时根据工具名路由到对应 client.callTool()
 * 4) 把 MCP 返回的 content 数组拍平为字符串，喂回 LLM
 * 5) 进程退出时优雅关闭所有 client（避免僵尸子进程）
 *
 * 兼容性：
 * - Windows 上 spawn 'npx' 需要 .cmd 后缀；这里统一推荐用 'node' + 本地路径，避免该问题
 * - env 中的 ${VAR} 占位符会从 process.env 解析；未解析的会被丢弃
 */
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const NAME_SEPARATOR = '__'

const state = {
  clients: new Map(), // serverName -> { client, transport }
  tools: new Map(),   // exposedName(serverName__toolName) -> { serverName, originalName, schema }
}

/**
 * 把 env 配置中的 ${VAR} 占位符替换为 process.env 中的实际值。
 * 同时把相对路径（./xxx 或 ../xxx）自动 resolve 为基于 backend cwd 的绝对路径，
 * 避免子进程内部把相对路径误当成"相对它自己脚本所在目录"。
 *
 * 返回 { env, missing }，missing 列出所有"占位符引用了不存在/为空的环境变量"的项。
 */
function resolveEnv(envCfg = {}) {
  const env = {}
  const missing = []
  for (const [k, v] of Object.entries(envCfg)) {
    if (typeof v !== 'string') continue
    let hasMissing = false
    const replaced = v.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
      const val = process.env[name]
      if (!val) {
        hasMissing = true
        missing.push({ key: k, varName: name })
      }
      return val || ''
    })
    if (hasMissing || !replaced) continue
    env[k] = /^\.{1,2}[/\\]/.test(replaced)
      ? path.resolve(process.cwd(), replaced)
      : replaced
  }
  return { env, missing }
}

/** 启动单个 MCP Server */
async function startOne(name, cfg) {
  const { env, missing } = resolveEnv(cfg.env)
  if (missing.length) {
    const detail = missing
      .map((m) => `${m.key}=\${${m.varName}}`)
      .join(', ')
    throw new Error(
      `缺少环境变量：${detail}。请在 backend/.env 中设置后重启。`
    )
  }
  const transport = new StdioClientTransport({
    command: cfg.command,
    args: cfg.args || [],
    env: { ...process.env, ...env },
    stderr: 'pipe',
  })

  const client = new Client(
    { name: 'react-ai', version: '1.0.0' },
    { capabilities: {} }
  )

  await client.connect(transport)
  state.clients.set(name, { client, transport })

  const { tools } = await client.listTools()
  for (const t of tools) {
    const exposed = `${name}${NAME_SEPARATOR}${t.name}`
    state.tools.set(exposed, {
      serverName: name,
      originalName: t.name,
      schema: t,
    })
  }
  return tools.map((t) => t.name)
}

/**
 * 启动所有 enabled 的 MCP Server。单个失败不影响其它。
 * @param {{ mcpServers: Record<string, any> }} config
 */
export async function startMcpServers(config) {
  const entries = Object.entries(config?.mcpServers || {}).filter(
    ([, cfg]) => cfg && cfg.enabled !== false
  )
  if (!entries.length) {
    console.log('[MCP] no servers configured')
    return
  }

  await Promise.all(
    entries.map(async ([name, cfg]) => {
      try {
        const toolNames = await startOne(name, cfg)
        console.log(`[MCP] ${name} ready, tools: [${toolNames.join(', ')}]`)
      } catch (err) {
        console.error(`[MCP] ${name} failed: ${err.message}`)
      }
    })
  )
}

/** 返回 OpenAI Tool Calling 协议格式（注意：name 已加 serverName 前缀防冲突） */
export function getMcpToolSchemas() {
  return [...state.tools.entries()].map(([exposed, { schema }]) => ({
    type: 'function',
    function: {
      name: exposed,
      description: schema.description || '',
      parameters: schema.inputSchema || { type: 'object', properties: {} },
    },
  }))
}

export function isMcpTool(name) {
  return state.tools.has(name)
}

/** 执行 MCP 工具调用，把 MCP 的 content 数组拍平为字符串 */
export async function callMcpTool(name, args, { signal } = {}) {
  const entry = state.tools.get(name)
  if (!entry) throw new Error(`MCP tool not found: ${name}`)
  const { client } = state.clients.get(entry.serverName)

  const res = await client.callTool(
    { name: entry.originalName, arguments: args || {} },
    undefined,
    { signal }
  )

  const text = (res.content || [])
    .map((c) => (typeof c.text === 'string' ? c.text : JSON.stringify(c)))
    .join('\n')

  if (res.isError) {
    throw new Error(text || `MCP tool ${name} returned error`)
  }
  return text
}

/** 进程退出前优雅关闭所有 client（kill 子进程） */
export async function stopMcpServers() {
  const tasks = []
  for (const [name, { client }] of state.clients) {
    tasks.push(
      client.close().catch((err) => {
        console.error(`[MCP] close ${name} failed: ${err.message}`)
      })
    )
  }
  await Promise.allSettled(tasks)
  state.clients.clear()
  state.tools.clear()
}
