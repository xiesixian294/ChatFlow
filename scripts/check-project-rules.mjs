#!/usr/bin/env node
/**
 * 轻量静态检查，辅助落实 PROJECT_RULES.md。
 * 用法：node scripts/check-project-rules.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const backendSrc = path.join(root, 'backend', 'src')

const errors = []

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, acc)
    else if (name.endsWith('.js')) acc.push(full)
  }
  return acc
}

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/')
}

const jsFiles = walk(backendSrc)

for (const file of jsFiles) {
  const content = fs.readFileSync(file, 'utf8')
  const r = rel(file)

  if (r !== 'backend/src/db/index.js' && r !== 'backend/src/db/init.js') {
    if (/mysql\.createPool|mysql2\/promise/.test(content)) {
      errors.push(`${r}: 禁止在 db/ 外创建 MySQL 连接，请使用 db/index.js 的 query()`)
    }
  }

  if (r.startsWith('backend/src/routes/') && r !== 'backend/src/routes/auth.js') {
    if (!content.includes('authRequired')) {
      errors.push(`${r}: 路由文件应使用 authRequired（auth.js 除外）`)
    }
  }

  if (r.startsWith('backend/src/middleware/') && r !== 'backend/src/middleware/auth.js') {
    if (/jwt\.(verify|sign)/.test(content)) {
      errors.push(`${r}: JWT 逻辑应集中在 middleware/auth.js`)
    }
  }
}

const indexJs = path.join(backendSrc, 'index.js')
const indexContent = fs.readFileSync(indexJs, 'utf8')
const routeFiles = fs
  .readdirSync(path.join(backendSrc, 'routes'))
  .filter((f) => f.endsWith('.js'))

for (const rf of routeFiles) {
  const base = rf.replace(/\.js$/, '')
  if (base === 'index') continue
  const mountPattern = new RegExp(`/api/${base.replace(/([.*+?^${}()|[\]\\])/g, '\\$1')}`)
  if (!mountPattern.test(indexContent) && !indexContent.includes(`routes/${rf}`)) {
    errors.push(`backend/src/routes/${rf}: 未在 index.js 中挂载 /api/ 路由`)
  }
}

if (errors.length) {
  console.error('PROJECT_RULES 检查未通过:\n')
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error('\n详见 PROJECT_RULES.md')
  process.exit(1)
}

console.log('PROJECT_RULES 静态检查通过 ✓')
