/**
 * Tool 注册中心：聚合「本地工具」 + 「MCP 工具」
 *
 * - LOCAL_SCHEMAS / localHandlers：进程内直接实现的工具
 * - getMcpToolSchemas()：来自外部 MCP Server，启动时动态发现
 * - buildToolSchemas()：每次请求 LLM 时调用，得到完整工具列表
 *
 * 新增本地工具：
 * 1) 在 LOCAL_SCHEMAS 追加 JSON Schema
 * 2) 在 localHandlers 注册 (args, { signal }) => Promise<any>
 *
 * 新增 MCP 工具：编辑 backend/mcp.config.json 即可，无需改代码
 */
import { getWeather } from './weather.js'
import { getCurrentTime } from './time.js'
import { getMcpToolSchemas } from '../mcp/client.js'

const LOCAL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description:
        '查询指定城市当前的实时天气，返回温度、体感、湿度、风速、天气状况。当用户问到「天气」「温度」「下雨」「几度」「冷不冷」等与气象相关的问题时调用。',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: '城市名称，支持中英文，例如「北京」「Shanghai」「Tokyo」',
          },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description:
        '获取当前精确的日期、时间、星期与时区。当用户提问涉及「今天」「现在」「几号」「星期几」「最近 N 天」「本周/本月」等时间相关词，且你不确定真实当前时间时，必须先调用此工具，再决定下一步行动（例如配合联网搜索查询某天的事件）。',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'IANA 时区名，例如 Asia/Shanghai、America/New_York。默认 Asia/Shanghai。',
          },
        },
      },
    },
  },
]

export const localHandlers = {
  get_weather: getWeather,
  get_current_time: getCurrentTime,
}

/** 每轮 LLM 请求都重新聚合：本地优先，MCP 工具追加在后 */
export function buildToolSchemas() {
  return [...LOCAL_SCHEMAS, ...getMcpToolSchemas()]
}
