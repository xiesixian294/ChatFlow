# 项目开发规范（PROJECT_RULES）

本文档约定 **react-ai** 全栈项目的目录职责、后端组件放置、MySQL 访问方式与 API 安全规范。新增或修改代码时应优先遵循本文；与 `README.md` 冲突时，以本文 **后端与数据层** 细则为准。

---

## 1. 适用范围与原则

| 原则 | 说明 |
| --- | --- |
| 分层清晰 | HTTP 入口、业务逻辑、数据访问、基础设施各司其职，禁止跨层直接耦合 |
| 保持简单 | 小功能可在 `routes` 内直接调用 `query()`；逻辑变复杂再下沉到 `services` / `repositories` |
| 安全默认 | 除明确公开的接口外，一律鉴权；凡涉及用户资源，必须校验归属（`user_id`） |
| 可观测 | 错误由统一错误处理中间件兜底；业务错误返回明确 HTTP 状态码与 `message` |

---

## 2. 仓库顶层结构

```
react-ai/
├── frontend/          # React + Vite 前端（见第 8 节简要约定）
├── backend/           # Express API 服务（本文重点）
│   ├── src/
│   ├── uploads/       # 运行时上传目录（勿提交用户文件）
│   └── .env.example
├── PROJECT_RULES.md   # 本文件
└── README.md          # 快速启动与接口一览
```

后端所有业务源码位于 `backend/src/`，**禁止**在 `backend/` 根目录散落业务 `.js` 文件（配置、脚本除外）。

---

## 3. 后端目录结构与组件放置规则

### 3.1 目录职责一览

| 目录 / 文件 | 职责 | 允许 | 禁止 |
| --- | --- | --- | --- |
| `src/index.js` | 应用入口：中间件注册、路由挂载、全局错误处理、启动监听 | `express` 装配、`cors`、`json` 解析 | 业务 SQL、复杂业务逻辑、单路由实现 |
| `src/routes/` | **HTTP 层**：解析请求、校验参数、调用 service / `query`、返回 JSON/SSE | 参数校验、状态码、`res.json` / SSE 头 | 直接调用 LLM SDK（应走 `services`）、长算法 |
| `src/middleware/` | **横切关注点**：鉴权、上传、限流等 Express 中间件 | `req` 增强（如 `req.user`）、提前 `return` 401/403 | 访问数据库（鉴权解析 token 除外）、业务编排 |
| `src/services/` | **领域业务**：LLM、上下文、附件、文件解析、流管理等 | 组合多步逻辑、调用 `query`、调用外部 API | 直接读写 `req`/`res`（除 SSE 流式写入由 route 委托的例外） |
| `src/db/` | **数据库基础设施**：连接池、通用查询、表结构初始化 | `pool`、`query()`、`init.js` 建表/迁移 | 业务规则、按用户维度的权限判断 |
| `src/repositories/` | （可选）**数据访问层**：按表/聚合封装 SQL | 单表 CRUD、可复用查询 | HTTP、JWT、文件 I/O |
| `src/config/` | 从环境变量读取的**静态配置**（无业务分支） | 上传大小、路径常量 | 异步逻辑、数据库连接 |
| `src/utils/` | **纯函数工具**：与框架无关 | 文件名解码、格式化 | 依赖 `req`、访问 `process.env`（应用配置请放 `config`） |
| `uploads/` | 用户上传文件落盘（由 `services/fileStorage` 管理） | 按用户/UUID 分目录存储 | 手写 SQL、路由定义 |

### 3.2 新增功能时的放置决策

```
收到新需求
    │
    ├─ 仅 1～2 条 SQL + 简单校验？
    │       └─► routes/<模块>.js 内完成（与现有 auth、conversations 一致）
    │
    ├─ 多表/多步/需复用（如附件、上下文、LLM）？
    │       └─► services/<name>.js，由 routes 调用
    │
    ├─ 同一 SQL 在 ≥3 处重复，或单文件 SQL 超过 ~80 行？
    │       └─► 新建 repositories/<entity>.js，仅导出数据访问函数
    │
    └─ 新的横切行为（鉴权变体、限流、审计）？
            └─► middleware/<name>.js，在 routes 或 index.js 挂载
```

### 3.3 路由模块（`routes/`）规范

- **一域一路由文件**：`auth.js`、`conversations.js`、`chat.js`、`files.js`；新业务能力优先新建 `routes/<resource>.js`，在 `index.js` 挂载为 `app.use('/api/<resource>', router)`。
- **统一前缀**：对外路径均以 `/api` 开头（健康检查等白名单除外）。
- **Router 级鉴权**：整个模块均需登录时，使用 `router.use(authRequired)`（参考 `conversations.js`、`files.js`）；仅部分接口公开时，在单条路由上挂载 `authRequired`（参考 `auth.js` 的 `/me`）。
- **路由处理器职责**：校验 body/query/params → 调用 service 或 `query` → 映射 HTTP 状态码；**不在路由内写超过 30 行的纯算法**，应下沉 `services/`。

### 3.4 服务层（`services/`）规范

- 文件名使用 **camelCase**，与领域一致：`llm.js`、`context.js`、`attachments.js`。
- 入参显式传递 `userId`、`conversationId` 等，**不依赖** `req.user`（便于单测与复用）。
- 可导入 `query` 访问数据库；涉及外部 IO（LLM、磁盘）的放在本层，不散落在 `routes`。
- 导出函数应语义化：`buildChatContext`、`loadReadyFilesForUser`，避免 `handle`、`process` 等笼统命名。

### 3.5 中间件（`middleware/`）规范

- 只做与 HTTP 管道相关的事：解析 token、处理 multipart、记录请求 ID 等。
- 鉴权统一使用 `middleware/auth.js` 的 `authRequired`；**禁止**在多个路由文件内复制 JWT 解析逻辑。
- 鉴权成功后，`req.user` 形状为 JWT payload（当前为 `{ id, username }`），路由内使用 `req.user.id` 作为 `user_id`。

### 3.6 配置与工具

- **环境变量**：仅在 `db/index.js`、`middleware/auth.js`、`services/*` 需要处通过 `process.env` 读取；魔法数字放入 `config/`（如 `config/upload.js`）。
- **`.env`**：不得提交仓库；新增变量必须同步更新 `backend/.env.example` 并注释含义。

### 3.7 LLM 工具调用与 MCP

工具调用（Function Calling）相关代码统一放在 `services/` 下的三处，**禁止**散落到 `routes/`：

| 文件 / 目录 | 职责 |
| --- | --- |
| `services/tools/<name>.js` | **本地工具实现**：纯函数 `async (args, { signal }) => result`，不感知 HTTP/SSE |
| `services/tools/registry.js` | 注册中心：维护 `LOCAL_SCHEMAS`（发给 LLM）、`localHandlers`（name → handler），导出 `buildToolSchemas()` 聚合本地 + MCP |
| `services/toolDispatcher.js` | 统一分发：按工具名路由到本地 handler 或 MCP Client，提供超时与异常隔离，返回 `{ result } \| { error }` |
| `services/mcp/client.js` | MCP Client 管理器：启动 / 关闭子进程、`listTools`、`callTool` |
| `backend/mcp.config.json` | MCP Server 配置（`mcpServers` 字段，结构与 Claude Desktop 一致） |

**新增本地工具**：在 `services/tools/` 增加 `<name>.js`，在 `registry.js` 的 `LOCAL_SCHEMAS` / `localHandlers` 各加一条，**无需**改 `chat.js`。

**新增外部能力（搜索、文件系统、GitHub 等）**：优先在 `mcp.config.json` 加一个 MCP Server，**不要**写本地适配代码。涉及 API Key 时通过 `${ENV_NAME}` 占位符引用 `.env`，并把变量加入 `.env.example`。

**本地 vs MCP 的决策**：
- 进程内 `new Date()`、`process.env` 这种**一行可得**的能力 → 本地工具（如 `get_current_time`）
- 需要外部 API、子进程、跨语言或希望复用社区生态 → MCP Server
- 反例：不要把"获取当前时间"这种琐事起一个 MCP 子进程，过度工程

**禁止**：

- 在 `routes/chat.js` 内 `import` 任何具体工具实现（只能 `import { buildToolSchemas, dispatchToolCall }`）
- 在工具 handler 内访问 `req`/`res` 或数据库（如确需用户态，由上层把所需字段当参数传入）
- 把 MCP Server 的 API Key 硬编码到 `mcp.config.json`

---

## 4. MySQL 交互与文件放置规范

### 4.1 文件职责（强制）

| 文件 | 用途 |
| --- | --- |
| `backend/src/db/index.js` | **唯一**对外导出的连接入口：`pool`、`query(sql, params)` |
| `backend/src/db/init.js` | **仅**负责建库、建表、增量 `ALTER`（通过 `npm run db:init` 执行） |
| `backend/src/db/migrations/` | （可选）版本化迁移脚本 `001_xxx.sql`，由独立 npm script 执行 |
| `backend/src/repositories/*.js` | （可选）按实体封装 SQL，内部只调用 `query` |

**禁止**：

- 在 `routes`、`middleware`、`utils` 中新建第二个 MySQL 连接池；
- 在 `init.js` 中编写业务接口或 HTTP 相关代码；
- 使用字符串拼接将用户输入嵌入 SQL（必须使用 `?` 占位符）。

### 4.2 访问方式

所有运行时查询 **必须** 通过：

```js
import { query } from '../db/index.js'

const rows = await query('SELECT id FROM users WHERE id = ?', [userId])
```

- 使用 `mysql2/promise` 的 `pool.execute`（已在 `query` 中封装），自动使用预处理语句。
- 连接参数仅来自环境变量：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。
- 字符集统一 **utf8mb4**（已在 pool 配置中指定）。

### 4.3 表结构与变更流程

1. 修改 `db/init.js` 中的 `CREATE TABLE` 或 `ensureColumn` 逻辑；
2. 本地执行 `npm run db:init` 验证；
3. 在 PR / 提交说明中注明 **表结构变更** 及是否需要 DBA 手动执行；
4. 生产环境优先采用可重复执行的增量方式（`ensureColumn` 或 migrations），避免直接手改线上库。

### 4.4 何时引入 `repositories/`

满足以下 **任一** 条件时，将 SQL 从 `routes` / `services` 抽到 `repositories/<entity>.js`：

- 同一实体（如 `conversations`）的 SQL 在 3 处以上重复；
- 单文件内 SQL 片段合计超过约 80 行；
- 需要集中维护复杂 JOIN、分页、乐观锁等。

Repository 示例约定：

```js
// repositories/conversation.js
import { query } from '../db/index.js'

export async function findByIdForUser(id, userId) {
  return query(
    'SELECT id, title FROM conversations WHERE id = ? AND user_id = ?',
    [id, userId]
  )
}
```

- Repository **只做数据读写**，返回原始行或 DTO 对象；
- **权限与业务规则**（如「空会话复用」）留在 `services` 或 `routes`。

### 4.5 数据访问安全要点

- 凡读取/修改 `conversations`、`messages`、`files` 等用户资源，SQL 的 `WHERE` 必须包含 **`user_id = ?`**（或等价的归属子查询），参数来自 `req.user.id`，**不得**信任客户端传入的 `userId`。
- 删除、更新前先 `SELECT` 校验归属，不存在时返回 **404**（`会话不存在`），避免通过枚举泄露资源是否存在（敏感场景可统一 404）。
- 批量操作使用事务时，在 `services` 层用 `pool.getConnection()` + `beginTransaction`/`commit`/`rollback`，不要暴露在 `routes`。

---

## 5. API 设计、防护与安全规范

### 5.1 URL 与方法约定

| 约定 | 示例 |
| --- | --- |
| 基础路径 | `/api/<资源>` |
| 集合列表 | `GET /api/conversations` |
| 创建资源 | `POST /api/conversations` |
| 子资源 | `GET /api/conversations/:id/messages` |
| 动作型接口 | `POST /api/chat/cancel`（动词放在路径末段） |
| 健康检查 | `GET /api/health`（无需鉴权） |

请求/响应体统一使用 **JSON**，字段对外使用 **camelCase**（数据库 snake_case 在路由层映射）。

### 5.2 鉴权与白名单

**公开接口（无需 `authRequired`）**：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 服务存活探测 |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |

**受保护接口**：其余所有 `/api/*` 路由必须经过 `authRequired`。

实现方式（二选一，同一模块内保持一致）：

```js
// 方式 A：整模块保护（推荐用于纯私有资源）
router.use(authRequired)

// 方式 B：单路由保护
router.get('/me', authRequired, handler)
```

### 5.3 Token 传递

| 场景 | 方式 |
| --- | --- |
| 常规 REST | 请求头 `Authorization: Bearer <token>` |
| SSE（`EventSource` 无法带自定义头） | Query：`?token=<token>`（`authRequired` 已支持从 `req.query.token` 读取） |

前端流式聊天应使用 **fetch + ReadableStream** 并在 Header 中带 Bearer（见 README）；仅在无法带 Header 时使用 query token。

### 5.4 资源归属与越权防护（必做）

对路径参数 `:id`、`:conversationId` 以及 body 中的关联 ID：

1. 转换为数字并校验合法性（`Number(id)` 无效则 **400**）；
2. 查询时 **始终** 带上 `AND user_id = ?`，绑定 `req.user.id`；
3. 查无记录 → **404**，不返回其他用户数据；
4. 附件、消息等跨表资源，通过 JOIN 或二次查询确认链路归属当前用户。

参考现有实现：`conversations.js` 的 `/:id/messages`、`files.js` 的 `assertConversationOwned`。

### 5.5 输入校验与响应格式

- **400**：缺少必填参数、格式错误（如 `用户名和密码必填`）；
- **401**：未登录、token 无效（`未登录` / `token 无效或已过期` / `用户不存在` / `密码错误`）；
- **404**：资源不存在或不属于当前用户；
- **409**：资源冲突（如用户名已占用）；
- **500**：未预期异常，由 `index.js` 全局 `app.use((err, req, res, next) => …)` 处理，不向客户端泄露堆栈。

成功响应示例：

```json
{ "list": [] }
{ "id": 1, "title": "新对话" }
{ "token": "...", "user": { "id": 1, "username": "demo" } }
```

错误响应统一：

```json
{ "message": "可读的中文错误说明" }
```

**禁止**在响应中返回密码哈希、JWT 密钥、完整 `extracted_text`（大文本用 preview 截断，见 `files.js`）。

### 5.6 其他安全要求

- **密码**：仅存储 bcrypt 哈希（成本因子 10），禁止明文或弱哈希。
- **JWT**：`JWT_SECRET` 必须为强随机字符串；生产环境禁止使用 `.env.example` 默认值。
- **文件上传**：必须经过 `middleware/upload.js` 与 `config/upload.js` 的大小、类型限制；解析逻辑在 `services/fileParser.js`，禁止在路由内直接 `fs.readFile` 未校验路径。
- **CORS**：由 `index.js` 统一配置；生产需限制 `origin`，勿使用 `*` 配合凭证。
- **请求体大小**：全局 `express.json({ limit: '2mb' })`，上传走 multipart 单独限制。
- **敏感配置**：`LLM_API_KEY`、数据库密码仅存在于服务端 `.env`，不得出现在前端构建产物或仓库中。

### 5.7 新增路由检查清单

- [ ] 已在 `index.js` 挂载且路径符合 `/api/...`
- [ ] 已明确公开或受保护，受保护路由已加 `authRequired`
- [ ] 涉及用户数据的所有 SQL 含 `user_id` 条件
- [ ] 参数校验完整，错误状态码符合第 5.5 节
- [ ] 未将密钥、完整私有文件内容写入响应
- [ ] 若新增表/字段，已更新 `db/init.js` 与 `.env.example`
- [ ] 已在 `README.md` 接口表中补充说明（若为用户可见 API）

---

## 6. 命名与代码风格（后端）

| 类型 | 约定 |
| --- | --- |
| 文件 | 路由、中间件、服务：`camelCase.js`；若引入 Repository：`conversation.js`（单数实体名） |
| 导出 | 路由默认 `export default router`；库函数使用命名导出 |
| 模块导入 | ESM：`import x from './x.js'`，相对路径带 `.js` 后缀 |
| 异步 | 路由 handler 使用 `async (req, res) => {}`，错误交给 `try/catch` 或抛出由全局 handler 处理 |
| 日志 | 使用 `console.error` 记录异常；避免 `console.log` 输出 token 或密码 |

---

## 7. 依赖方向（架构约束）

```
index.js
   └── routes/*
          ├── middleware/*（鉴权、上传）
          ├── services/*（业务）
          │      ├── db/index.js（query）
          │      ├── repositories/*（可选）
          │      └── config/*、utils/*
          └── db/index.js（简单 CRUD 可直接）
```

**禁止的依赖**：

- `db/*` → `routes` / `services`
- `utils` → `routes` / `services` / `db`
- `middleware` → `services`（中间件应保持轻量）

---

## 8. 前端简要约定（非本文重点）

- 页面：`frontend/src/pages/`
- 可复用 UI：`components/ui/`（shadcn）、业务组件：`components/chat/`
- API 封装：`frontend/src/lib/`，统一走 `/api` 代理，Bearer token 由 store 注入
- 新增后端接口时，同步在 `lib` 中封装请求函数，避免在组件内散落 `fetch` URL

---

## 9. 文档维护

- 架构级变更（新增顶层目录、鉴权方式变更、数据库访问入口变更）须同步更新本文。
- 接口行为变更须同步更新 `README.md` 的「主要接口」表。
- AI 辅助开发时，可将本文作为 Cursor Rule 或 Agent 上下文引用，保证生成代码与仓库结构一致。

---

*最后更新：与当前 `backend/src` 结构对齐（Express + mysql2 + JWT + SSE）。*
