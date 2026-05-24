---
name: create-api
description: Add a new HTTP API endpoint to the react-ai project (Express + MySQL backend, axios + sonner frontend). Use when the user asks to create a new API, add an endpoint, add a route, expose a new resource, or wire up frontend-backend communication. Covers backend route + service + SQL, frontend request method, JSDoc typings, and error handling.
---

# 新增 API 全流程

本 skill 描述向 **react-ai** 项目新增一个 HTTP API 的标准流程：从后端建表/路由/服务，到前端封装请求与类型，再到错误处理。遵循 `PROJECT_RULES.md` 与 `.cursor/rules/backend.mdc` / `frontend.mdc`。

## 标准目录约定

```
backend/src/
  routes/<resource>.js     # HTTP 层：参数校验、状态码、调用 service
  services/<name>.js       # 业务逻辑、外部 IO（可选，简单 CRUD 可跳过）
  db/index.js              # 唯一 MySQL 入口（query / pool）
  db/init.js               # 表结构 / ensureColumn
  utils/HttpError.js       # 业务异常类
  utils/asyncHandler.js    # ah() 包裹 async 路由
  index.js                 # 路由挂载 + 全局错误兜底

frontend/src/lib/
  api.js                   # axios 实例（拦截器、token、toast）
  <resource>.js            # 该资源的请求函数 + JSDoc 类型
```

## 工作流（按顺序执行）

复制并跟踪此清单：

```
- [ ] 1. 评估是否需要新建 service（多步业务/外部 IO/复用）
- [ ] 2. 若涉及新表/字段：更新 backend/src/db/init.js + .env.example
- [ ] 3. 在 backend/src/routes/<resource>.js 写路由（ah + HttpError）
- [ ] 4. 在 backend/src/index.js 挂载路由：app.use('/api/<resource>', router)
- [ ] 5. 在 frontend/src/lib/<resource>.js 添加 JSDoc 类型 + 请求函数
- [ ] 6. 业务组件调用请求函数，决定是否 skipErrorToast
- [ ] 7. 更新 README.md 接口表 + PROJECT_RULES.md 相关接口
- [ ] 8. 运行 node scripts/check-project-rules.mjs
```

## 第 1 步：决定文件放置

参照 `PROJECT_RULES.md` 第 3.2 节决策树：

- **1~2 条 SQL + 简单校验** → 直接写在 `routes/<resource>.js`，不需要 service
- **多表/多步/需复用（如 LLM、文件解析）** → 抽到 `services/<name>.js`，由 route 调用
- **同一 SQL 在 ≥3 处重复** → 抽到 `repositories/<entity>.js`

## 第 2 步：后端 service（可选）

仅当业务复杂时创建。**入参显式传 `userId`，不依赖 `req`**：

```js
// backend/src/services/<name>.js
import { query } from '../db/index.js'
import { notFound } from '../utils/HttpError.js'

export async function listForUser(userId) {
  return query('SELECT id, name FROM items WHERE user_id = ? ORDER BY id DESC', [userId])
}

export async function getOwnedOrThrow(id, userId) {
  const rows = await query(
    'SELECT * FROM items WHERE id = ? AND user_id = ?',
    [id, userId]
  )
  if (!rows.length) throw notFound('资源不存在')
  return rows[0]
}
```

## 第 3 步：后端路由（必做）

模板：

```js
// backend/src/routes/<resource>.js
import { Router } from 'express'
import { query } from '../db/index.js'
import { authRequired } from '../middleware/auth.js'
import { ah } from '../utils/asyncHandler.js'
import { badRequest, notFound, conflict } from '../utils/HttpError.js'

const router = Router()

router.use(authRequired)

router.get(
  '/',
  ah(async (req, res) => {
    const rows = await query(
      'SELECT id, name FROM items WHERE user_id = ?',
      [req.user.id]
    )
    res.json({ list: rows })
  })
)

router.post(
  '/',
  ah(async (req, res) => {
    const name = (req.body?.name || '').trim()
    if (!name) throw badRequest('name 必填')

    const result = await query(
      'INSERT INTO items (user_id, name) VALUES (?, ?)',
      [req.user.id, name]
    )
    res.status(201).json({ id: result.insertId, name })
  })
)

router.get(
  '/:id',
  ah(async (req, res) => {
    const rows = await query(
      'SELECT id, name FROM items WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    if (!rows.length) throw notFound('资源不存在')
    res.json(rows[0])
  })
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    await query(
      'DELETE FROM items WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    res.json({ ok: true })
  })
)

export default router
```

**必守规则**：

| 规则 | 原因 |
| --- | --- |
| 所有 async 路由必须用 `ah()` 包裹 | Express 4 不会自动转发 async reject |
| 业务错误抛 `HttpError`（`badRequest/notFound/conflict/unauthorized`） | message 会原样返回前端 |
| 普通 `throw new Error()` | 一律 500 + 「服务器内部错误」，message 不外泄 |
| SQL 用 `?` 占位符 | 防 SQL 注入 |
| 用户资源 SQL 必须含 `user_id = ?`，参数来自 `req.user.id` | 防越权 |
| 不存在的资源返回 **404**，不返回 200 + null | 不泄露资源存在性 |
| 仅 `auth/register`、`auth/login`、`health` 可不鉴权 | 其余都要 `authRequired` |

## 第 4 步：挂载路由

```js
// backend/src/index.js
import itemsRouter from './routes/items.js'
app.use('/api/items', itemsRouter)
```

路径必须以 `/api/<resource>` 开头，使用复数小写。

## 第 5 步：表结构变更（如需）

```js
// backend/src/db/init.js
await conn.query(`
  CREATE TABLE IF NOT EXISTS items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    CONSTRAINT fk_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)

// 新增字段使用 ensureColumn（已在 init.js 定义）以便重复运行
await ensureColumn(conn, 'items', 'tag', 'tag VARCHAR(64) NULL AFTER name')
```

然后执行：`cd backend && npm run db:init`

## 第 6 步：前端请求层 + 类型

项目是纯 JavaScript，**使用 JSDoc 描述类型**，VSCode / Cursor 会推断并提示。

```js
// frontend/src/lib/items.js
import api from './api'

/**
 * @typedef {Object} Item
 * @property {number} id
 * @property {string} name
 * @property {string} [createdAt]
 */

/**
 * @typedef {Object} CreateItemPayload
 * @property {string} name
 */

/**
 * 获取当前用户的资源列表
 * @returns {Promise<{ list: Item[] }>}
 */
export async function listItems() {
  const { data } = await api.get('/items')
  return data
}

/**
 * 创建资源
 * @param {CreateItemPayload} payload
 * @returns {Promise<Item>}
 */
export async function createItem(payload) {
  const { data } = await api.post('/items', payload)
  return data
}

/**
 * 获取单个资源详情
 * @param {number} id
 * @returns {Promise<Item>}
 */
export async function getItem(id) {
  const { data } = await api.get(`/items/${id}`)
  return data
}

/**
 * 删除资源
 * @param {number} id
 * @returns {Promise<{ ok: true }>}
 */
export async function deleteItem(id) {
  const { data } = await api.delete(`/items/${id}`)
  return data
}
```

**规范**：

- 字段对外用 **camelCase**；如果后端返回 snake_case，在路由层映射（或 DTO 函数）
- 一个 resource 一个文件，命名复数：`items.js` / `conversations.js`
- 文件只导出请求函数与类型，**不在组件里直接 `api.get('/items')`**
- JSDoc 写 `@typedef` 在文件顶部，函数用 `@param` / `@returns` 引用

## 第 7 步：错误处理

整条链路已经有兜底，**通常不用在业务里再 try/catch**：

| 层 | 自动处理 |
| --- | --- |
| 后端路由 | `ah()` 把异常转给全局 handler，按 status 返回 JSON |
| axios 拦截器 (`lib/api.js`) | 401 跳登录；超时/断网/4xx/5xx 自动 `toast.error` |
| 组件 | 失败时 axios 会 reject，可不写 try/catch（toast 已弹） |

**何时显式 try/catch**：

1. **失败后需要做善后**（回滚 UI、停止轮询、loading 关掉）
2. **不希望弹通用 toast**，自己渲染错误 → 传 `{ skipErrorToast: true }`

```js
// 场景 1：失败时要重置 UI
try {
  await createItem({ name })
  setName('')
} catch {
  // toast 已自动弹出，组件只做善后
}

// 场景 2：把错误显示在表单下方（参考 LoginPage）
try {
  await api.post('/auth/login', payload, { skipErrorToast: true })
} catch (err) {
  setError(err.response?.data?.message || '请求失败')
}
```

## 第 8 步：自检

1. 后端 lint：`cd backend && node --check src/routes/<resource>.js`（粗略检查语法）
2. 项目规则静态检查：`node scripts/check-project-rules.mjs`
3. smoke 测试（PowerShell）：

   ```powershell
   try { Invoke-RestMethod -Uri http://localhost:3001/api/items -Method Get } catch { "status=$($_.Exception.Response.StatusCode.value__) body=$($_.ErrorDetails.Message)" }
   ```

4. 更新 `README.md` 的「主要接口」表

## 文档与示例

- 简明检查清单：[checklist.md](checklist.md)
- 端到端完整示例（含组件调用）：[examples.md](examples.md)

## 反模式（禁止）

- 在 routes 里写 `mysql.createPool` 或字符串拼接 SQL
- 在组件里 `fetch('/api/...')` 或 `axios.get('/api/...')`
- 业务错误用 `throw new Error('xx')` 期望前端看到（应抛 `HttpError`）
- async 路由不加 `ah()` 包裹
- SQL 用客户端传入的 `userId`（必须 `req.user.id`）
- 返回密码哈希、JWT 密钥、完整 `extracted_text`
