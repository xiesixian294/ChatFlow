# React AI Chat

一个简洁的全栈 AI 聊天应用骨架，前后端分离，支持 SSE 流式响应。

## 技术栈

**前端**：React 19 + Vite + React Router + Redux Toolkit + TailwindCSS v4 + shadcn/ui  
**后端**：Node.js + Express + MySQL + JWT + SSE 流式转发

## 目录结构

```
react-ai/
├── frontend/                 # 前端 (Vite)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/           # shadcn/ui 基础组件
│   │   │   └── chat/         # 聊天相关组件
│   │   ├── pages/            # LoginPage / ChatPage
│   │   ├── lib/              # api / sse / utils
│   │   ├── store/            # Redux store
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css         # Tailwind v4 + 主题变量
│   ├── components.json
│   ├── vite.config.js
│   └── package.json
└── backend/                  # 后端 (Express)
    ├── src/
    │   ├── db/               # MySQL 连接 + 表结构初始化脚本
    │   ├── middleware/       # JWT 鉴权中间件
    │   ├── routes/           # auth / conversations / chat(SSE)
    │   ├── services/         # LLM SSE 解析
    │   └── index.js
    ├── .env.example
    └── package.json
```

## 快速开始

### 1. 准备数据库

确保本机 MySQL 已启动（可通过 Docker 启动）：

```bash
docker run -d --name react-ai-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -p 3306:3306 mysql:8
```

### 2. 启动后端

```bash
cd backend
cp .env.example .env       # 编辑数据库与 LLM 配置
npm install                # （首次运行）
npm run db:init            # 创建数据库和表
npm run dev                # 启动开发服务 http://localhost:3001
```

`.env` 中 `LLM_API_KEY` 留空时，后端会返回 mock 流式响应，便于在没有 API Key 的情况下联调。

### 3. 启动前端

```bash
cd frontend
npm install                # （首次运行）
npm run dev                # http://localhost:5173
```

Vite 已配置 `/api` 代理到后端 `http://localhost:3001`，前端直接调用 `/api/*` 即可。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册（返回 JWT） |
| POST | `/api/auth/login` | 登录（返回 JWT） |
| GET  | `/api/conversations` | 我的会话列表 |
| POST | `/api/conversations` | 新建会话 |
| GET  | `/api/conversations/:id/messages` | 获取会话消息 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| GET  | `/api/chat/stream?conversationId=&content=&attachmentIds=&token=` | SSE 流式聊天 |
| POST | `/api/files/upload` | 上传附件（整包，≤5MB 默认） |
| POST | `/api/files/upload/init` | 创建分片上传会话（大文件） |
| PUT  | `/api/files/upload/:uploadId/chunk/:index` | 上传单个分片 |
| GET  | `/api/files/upload/:uploadId/status` | 查询分片进度（断点续传） |
| POST | `/api/files/upload/:uploadId/complete` | 合并分片并完成上传 |
| GET  | `/api/files/:id` | 查询附件解析状态 |
| DELETE | `/api/files/:id` | 删除未使用的附件 |

SSE 事件：

- `event: delta` —— 增量内容 `{ content: '...' }`
- `event: tool_call` —— LLM 触发工具调用 `{ id, name, arguments, status:'running' }`
- `event: tool_result` —— 工具结果 `{ id, name, result, status:'done'|'failed' }`
- `event: done`  —— 流结束
- `event: error` —— 错误信息

## AI 工具能力（Function Calling + MCP）

后端通过 OpenAI Function Calling 协议向 LLM 暴露工具，并按工具类型路由：

| 工具 | 实现位置 | 说明 | 需要 Key |
| --- | --- | --- | --- |
| `get_weather` | 本地 `services/tools/weather.js` | 实时天气（Open-Meteo），带中文复合地名 / 拼音 fallback | ❌ |
| `get_current_time` | 本地 `services/tools/time.js` | 当前日期/时间/星期/时区，避免 LLM "今天几号"猜错 | ❌ |
| `tavily__*`（5 个） | MCP `tavily-mcp` | 联网搜索 / 抓取 / 站点检索 / 深度研究 | ✅ `TAVILY_API_KEY` |
| `memory__*`（9 个） | MCP `@modelcontextprotocol/server-memory` | 跨对话长期记忆（知识图谱），数据落盘 `data/memory.jsonl` | ❌ |

### 启用步骤

1. 在 [Tavily 控制台](https://app.tavily.com) 申请 API Key（免费 1000 次/月），写入 `backend/.env` 的 `TAVILY_API_KEY`
2. 启动 backend，控制台应打印：
   ```
   [MCP] tavily ready, tools: [tavily_search, ...]
   [MCP] memory ready, tools: [create_entities, ...]
   ```
3. 不想用搜索就在 `mcp.config.json` 里把 tavily 的 `"enabled": false`；不想用记忆同理

### 新增 MCP Server（无需改源码）

编辑 `backend/mcp.config.json`，例如要加 GitHub：

```json
{
  "mcpServers": {
    "github": {
      "enabled": true,
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

> 提示：
> - **Windows 推荐 `node` + 本地路径**（如 tavily/memory 的配置），避免 `npx` spawn 找不到 `.cmd` 后缀的问题  
> - **相对路径会自动 resolve 为绝对路径**（基于 backend cwd），所以 `./data/xxx.jsonl` 这种写法在任何 MCP server 内都能正确读到

## 设计要点

- **保持简单**：尽量平铺目录，避免过度抽象，便于初学者阅读
- **JWT 无状态鉴权**：所有受保护接口都通过 `Authorization: Bearer <token>` 鉴权
- **SSE 实现方式**：浏览器 `EventSource` 不支持自定义请求头，因此前端使用 `fetch + ReadableStream` 解析 `text/event-stream`，从而携带 JWT
- **上下文管理**：超过保留窗口或 token 阈值时，将较早消息 LLM 摘要后存入 `conversations.summary`，上下文结构为 `system + 摘要 + 最近 N 条完整对话`；摘要增量更新，避免每轮重复压缩
- **文件上传**：支持 txt / md / json / csv / 代码 / pdf / docx；后端解析文本入库（`files.extracted_text`），发送时通过 `attachmentIds` 拼入 prompt
- **UI 风格**：参考 ChatGPT，灰白色调、柔和阴影、subtle 动画
