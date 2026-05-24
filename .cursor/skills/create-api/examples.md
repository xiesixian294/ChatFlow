# 端到端示例：会话标签（tags）

需求：给每个会话打标签。需要列表、创建、删除三个接口。

## 1. 数据库

在 `backend/src/db/init.js` 增加：

```js
await conn.query(`
  CREATE TABLE IF NOT EXISTS tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    conversation_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id),
    INDEX idx_conv (conversation_id),
    UNIQUE KEY uniq_conv_name (conversation_id, name),
    CONSTRAINT fk_tags_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_tags_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`)
```

执行：`cd backend && npm run db:init`

## 2. 后端路由

新建 `backend/src/routes/tags.js`：

```js
import { Router } from 'express'
import { query } from '../db/index.js'
import { authRequired } from '../middleware/auth.js'
import { ah } from '../utils/asyncHandler.js'
import { badRequest, notFound, conflict } from '../utils/HttpError.js'

const router = Router()

router.use(authRequired)

async function assertConversationOwned(conversationId, userId) {
  const rows = await query(
    'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
    [conversationId, userId]
  )
  if (!rows.length) throw notFound('会话不存在')
}

router.get(
  '/',
  ah(async (req, res) => {
    const conversationId = Number(req.query.conversationId)
    if (!conversationId) throw badRequest('conversationId 必填')
    await assertConversationOwned(conversationId, req.user.id)

    const rows = await query(
      `SELECT id, name, created_at AS createdAt
       FROM tags WHERE conversation_id = ? ORDER BY id ASC`,
      [conversationId]
    )
    res.json({ list: rows })
  })
)

router.post(
  '/',
  ah(async (req, res) => {
    const conversationId = Number(req.body?.conversationId)
    const name = (req.body?.name || '').trim().slice(0, 64)
    if (!conversationId || !name) throw badRequest('参数缺失')
    await assertConversationOwned(conversationId, req.user.id)

    try {
      const result = await query(
        'INSERT INTO tags (user_id, conversation_id, name) VALUES (?, ?, ?)',
        [req.user.id, conversationId, name]
      )
      res.status(201).json({ id: result.insertId, name, createdAt: new Date() })
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict('该标签已存在')
      throw err
    }
  })
)

router.delete(
  '/:id',
  ah(async (req, res) => {
    const rows = await query(
      'SELECT id FROM tags WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    )
    if (!rows.length) throw notFound('标签不存在')

    await query('DELETE FROM tags WHERE id = ?', [req.params.id])
    res.json({ ok: true })
  })
)

export default router
```

注意点：

- 入参 `conversationId` 用 `Number()` 转换并校验
- 通过 `assertConversationOwned` 校验归属，防越权（直接复用同模式可以抽到 services）
- `ER_DUP_ENTRY` 转 409 给前端，**自然消息更友好**
- DB 列 `created_at` 在 SQL 中用 `AS createdAt` 直接映射

## 3. 挂载路由

`backend/src/index.js`：

```js
import tagsRouter from './routes/tags.js'
// ...
app.use('/api/tags', tagsRouter)
```

## 4. 前端请求层

新建 `frontend/src/lib/tags.js`：

```js
import api from './api'

/**
 * @typedef {Object} Tag
 * @property {number} id
 * @property {string} name
 * @property {string} createdAt
 */

/**
 * @typedef {Object} CreateTagPayload
 * @property {number} conversationId
 * @property {string} name
 */

/**
 * 获取某个会话下的所有标签
 * @param {number} conversationId
 * @returns {Promise<{ list: Tag[] }>}
 */
export async function listTags(conversationId) {
  const { data } = await api.get('/tags', { params: { conversationId } })
  return data
}

/**
 * 给会话添加一个标签
 * @param {CreateTagPayload} payload
 * @returns {Promise<Tag>}
 */
export async function createTag(payload) {
  const { data } = await api.post('/tags', payload)
  return data
}

/**
 * 删除标签
 * @param {number} id
 * @returns {Promise<{ ok: true }>}
 */
export async function deleteTag(id) {
  const { data } = await api.delete(`/tags/${id}`)
  return data
}
```

## 5. 组件调用

```jsx
import { useEffect, useState } from 'react'
import { listTags, createTag, deleteTag } from '@/lib/tags'

export default function TagsPanel({ conversationId }) {
  const [tags, setTags] = useState(/** @type {Tag[]} */ ([]))
  const [name, setName] = useState('')

  useEffect(() => {
    listTags(conversationId)
      .then((d) => setTags(d.list))
      .catch(() => {}) // toast 已自动弹出
  }, [conversationId])

  async function handleAdd() {
    if (!name.trim()) return
    try {
      const tag = await createTag({ conversationId, name })
      setTags((prev) => [...prev, tag])
      setName('')
    } catch {
      // 409「该标签已存在」由 axios 拦截器 toast 显示
    }
  }

  async function handleRemove(id) {
    const snapshot = tags
    setTags((prev) => prev.filter((t) => t.id !== id))
    try {
      await deleteTag(id)
    } catch {
      setTags(snapshot) // 失败回滚
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <span key={t.id} className="rounded bg-muted px-2 py-1 text-xs">
          {t.name}
          <button className="ml-1" onClick={() => handleRemove(t.id)}>×</button>
        </span>
      ))}
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <button onClick={handleAdd}>+</button>
    </div>
  )
}
```

要点：

- 用 `lib/tags` 封装，**组件内不再出现 `/api/tags` 字面量**
- 列表加载失败时 `.catch(() => {})` 忽略 — 拦截器已 toast
- 创建失败时不写 UI（toast 已显示）；删除采用乐观更新 + 失败回滚

## 6. smoke 测试（PowerShell）

```powershell
# 假设 $token 已通过 /api/auth/login 获取
$headers = @{ Authorization = "Bearer $token" }

# 创建（成功）
Invoke-RestMethod -Uri "http://localhost:3001/api/tags" -Method Post `
  -Headers $headers -ContentType 'application/json' `
  -Body '{"conversationId":1,"name":"重要"}'

# 创建重复（409）
try {
  Invoke-RestMethod -Uri "http://localhost:3001/api/tags" -Method Post `
    -Headers $headers -ContentType 'application/json' `
    -Body '{"conversationId":1,"name":"重要"}'
} catch { "status=$($_.Exception.Response.StatusCode.value__)" }
# 期望：status=409
```

## 7. README 接口表追加

```markdown
| GET    | `/api/tags?conversationId=` | 列表 |
| POST   | `/api/tags`                  | 新建（409 表示重复） |
| DELETE | `/api/tags/:id`              | 删除 |
```
