# 新增 API 检查清单

逐项打勾，确保符合 PROJECT_RULES.md。

## 后端

- [ ] 文件放置正确（route / service / repository 按决策树第 3.2 节）
- [ ] 路由文件在 `backend/src/routes/<resource>.js`
- [ ] 路由已在 `backend/src/index.js` 挂载，路径为 `/api/<resource>`
- [ ] 整模块需要登录：`router.use(authRequired)`；混合模式：单路由加 `authRequired`
- [ ] 所有 async route 用 `ah()` 包裹
- [ ] 业务错误使用 `badRequest / notFound / conflict / unauthorized / forbidden`
- [ ] SQL 全部使用 `?` 占位符，无字符串拼接
- [ ] 用户资源 SQL 必含 `WHERE user_id = ?`，参数来自 `req.user.id`
- [ ] 资源不存在统一返回 404
- [ ] 响应字段使用 camelCase（DB snake_case 在路由内映射）
- [ ] 不返回密码哈希、JWT 密钥、完整大文本

## 数据库（如有变更）

- [ ] 已在 `backend/src/db/init.js` 添加 `CREATE TABLE` 或 `ensureColumn`
- [ ] 已运行 `cd backend && npm run db:init` 本地验证
- [ ] 若新增环境变量，已同步 `backend/.env.example`

## 前端

- [ ] 在 `frontend/src/lib/<resource>.js` 封装请求函数（不在组件内硬编码 URL）
- [ ] 文件顶部 JSDoc `@typedef` 定义 DTO 类型
- [ ] 函数签名带 `@param` / `@returns`
- [ ] 组件调用封装函数；失败时是否需要 `skipErrorToast` 已决定
- [ ] 失败后的 UI 善后（loading 关闭、状态重置）已处理

## 文档

- [ ] `README.md` 「主要接口」表已更新
- [ ] 若新增公开（无鉴权）接口，已说明白名单

## 验证

- [ ] `node scripts/check-project-rules.mjs` 通过
- [ ] 已对每个 status code（200/400/401/404/409）做过 smoke 测试
