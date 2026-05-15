# HFUT AI Chat

一个前后端分离的 AI 聊天项目：

- 前端：Vue 3 + Vue Router + Vite
- 后端：Node.js + Express + MySQL
- 能力：学生登录、会话隔离、历史记录、流式聊天、主页应用中心

## 项目结构

```text
hfut-ai-chat/
  docker-compose.yml
  mysql/
    init.sql
  server/
    .env
    .env.example
    src/
  web/
    src/
```

## 已实现接口

### 认证

- `POST /auth/student/login`
- `GET /auth/me`

### AI 聊天

- `POST /ai/chat`
- `GET /ai/history/chat`
- `GET /ai/history/chat/:chatId`

## SSE 存储规则

后端严格按以下方式处理大模型 SSE：

- 只解析以 `data:` 开头的行
- 遇到 `[DONE]` 立即停止读取
- 从 `json.choices[0].delta.content` 中提取增量文本
- 使用 `fullContent` 按顺序拼接完整回复
- 流结束后只调用一次 `saveMessage(chatId, 'assistant', fullContent)`
- 不会把原始 `data: {...}` 协议内容写入数据库

## 数据库

### 方式一：Docker 启动 MySQL

确保本机已经启动 Docker Desktop 后执行：

```bash
docker compose up -d
```

### 方式二：使用你本机已有 MySQL

修改 `server/.env` 中以下配置：

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root123456
DB_NAME=hfut_ai_chat
```

## 启动方式

### 1. 启动后端

```bash
cd server
npm install
npm run dev
```

### 2. 启动前端

```bash
cd web
npm install
npm run dev
```

## 默认访问地址

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`

## 页面说明

- 登录页：玻璃拟态风格，按 `ai-portal-ui-style-kit` 搭建
- 主页：包含 `AI 聊天`、`肥工智能客服`、`ChatPDF` 三个模块
- 聊天页：左侧历史会话，右侧消息区和输入区

目前只有 `AI 聊天` 页面已完成，另外两个模块保留了主页入口和路由跳转占位。

## 说明

- 当前 `.env` 中已写入你提供的大模型 API Key
- 如果要提交代码仓库，建议把真实密钥移出版本库并改成环境变量注入
