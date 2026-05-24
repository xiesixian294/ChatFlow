# 阶段 6：UI 层与工程规范

## 目标

补齐聊天 UI 组件划分与前后端约定，体现「读过完整前端」。

---

## 1. 组件树（聊天页）

```
ChatPage
├── Sidebar              # 会话列表、新建、删除、streaming 标记
├── MessageList          # 滚动区、空状态
│   └── MessageBubble    # 单条：Markdown、附件、ToolCallCard
├── ChatInput            # 输入框、发送/停止、附件区
│   ├── AttachmentChips
│   └── FileUploadButton
└── (header 标题)
```

| 组件 | 文件 | 职责 |
|------|------|------|
| `Sidebar` | `components/chat/Sidebar.jsx` | `conversations`、`activeId`、`streamingIds` |
| `MessageList` | `MessageList.jsx` | 列表布局、`sending` 时底部 loading |
| `MessageBubble` | `MessageBubble.jsx` | 按 `role` 样式；渲染 markdown |
| `ToolCallCard` | `ToolCallCard.jsx` | 工具调用卡片 |
| `ChatInput` | `ChatInput.jsx` | 受控 `value`/`onChange`；Enter 发送 |
| `AttachmentChips` | `AttachmentChips.jsx` | 上传进度、重试、删除 |
| `FileUploadButton` | `FileUploadButton.jsx` | 隐藏 file input |

基础 UI（shadcn）：`components/ui/button.jsx`、`input.jsx`、`textarea.jsx` — 用 Tailwind v4 + CSS 变量主题（`index.css`）。

---

## 2. Markdown 渲染

`lib/markdown.js`：将 assistant 内容转为 HTML（注意 XSS：若面试问到，应说明是否消毒 — 需读源码确认是否用 DOMPurify 或仅 trusted 内容）。

用户消息多为纯文本；assistant 支持 GFM（表格、代码块），与 `chat.js` 里 `SYSTEM_PROMPT` 要求一致。

---

## 3. 样式与布局

- `index.css`：Tailwind v4 `@import "tailwindcss"` + shadcn 主题变量
- `ChatPage`：`h-screen flex` — 侧栏 + 主栏；内容区 `max-w-3xl` 居中（类 ChatGPT）
- `key={activeId ?? 'new'}`：切换会话时重置 `MessageList` / `ChatInput` 内部状态（如滚动）

---

## 4. 前端规范（`.cursor/rules/frontend.mdc`）

| 规则 | 原因 |
|------|------|
| API 统一走 `lib/` | 换 baseURL、加拦截器只改一处 |
| 禁止组件硬编码 `/api/...` | 除 `streamSSE` 的 url 拼接（可进一步封装到 `lib/chat.js`） |
| SSE 用 fetch 流 | 带 JWT |
| 新接口同步 `lib/` 方法 | 与后端字段 camelCase 对齐 |

Redux **仅用于 auth**；聊天状态在 `ChatPage` 本地 state（有意保持简单，面试可主动说明为何不全局化 messages）。

---

## 5. 后端规范（`.cursor/rules/backend.mdc`）

| 规则 | 原因 |
|------|------|
| `routes` 不写长算法 | 下沉 `services` |
| 唯一 `query()` | 连接池与 SQL 审计 |
| LLM 只经 `services/llm.js` | 换模型不改路由 |
| `HttpError` + `ah()` | 异步错误进全局 handler |

---

## 6. 阅读建议（约 1～2 天）

1. 通读 `MessageBubble.jsx` + `ToolCallCard.jsx`（工具 UI）
2. 扫 `ChatInput.jsx` 键盘与 disabled 逻辑
3. 对照 `frontend.mdc` / `backend.mdc` 与 `PROJECT_RULES.md` 第 8 节

---

## 7. 阶段验收

- [ ] 能说明为何 API 封装在 `lib/` 而非组件内
- [ ] 能列出 chat 相关组件各自职责
- [ ] 能解释 Redux 只管 auth 的取舍

---

## 8. 面试话术

1. **容器 vs 展示**：`ChatPage` 容器负责数据与 SSE；`MessageList`/`Bubble` 纯展示，便于测试与复用。
2. **设计系统**：shadcn 复制到仓库，可改源码，非黑盒 npm 组件库。
3. **多会话 streaming**：`streamingIds` 驱动侧栏状态，与 `convState.sending` 同步。

下一阶段 → [07-interview-handbook.md](./07-interview-handbook.md)
