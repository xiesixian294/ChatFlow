/**
 * 把 LLM 偶尔输出的「Tab / 多空格分隔表格」转换为标准 GFM Markdown 表格，
 * 以便 react-markdown + remark-gfm 能正常渲染。
 *
 * 触发条件（全部满足才视为表格）：
 *   - 连续 ≥ 2 行
 *   - 每行均包含分隔符（Tab 或 2 个以上连续空格）
 *   - 所有行的列数相同且 ≥ 2
 *   - 不在围栏代码块内
 */

function splitColumns(line) {
  // Tab 分隔优先；否则用「2 个及以上连续空格」分隔（中文字符之间常用 1 个空格，要求 ≥ 2 个避免误判）
  if (line.includes('\t')) {
    return line.split(/\t+/).map((s) => s.trim()).filter((s) => s !== '')
  }
  const cols = line.split(/ {2,}/).map((s) => s.trim()).filter((s) => s !== '')
  return cols
}

function looksLikeTableRow(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  // 已经是标准 markdown 表格行（以 | 起始）则不处理
  if (trimmed.startsWith('|')) return false
  const cols = splitColumns(trimmed)
  return cols.length >= 2
}

function toMarkdownTable(rows) {
  const colCount = rows[0].length
  const header = `| ${rows[0].join(' | ')} |`
  const sep = `| ${Array(colCount).fill('---').join(' | ')} |`
  const body = rows.slice(1).map((r) => `| ${r.join(' | ')} |`)
  return [header, sep, ...body].join('\n')
}

export function normalizeMarkdown(text) {
  if (!text || typeof text !== 'string') return text
  const lines = text.split('\n')
  const out = []
  let inCodeFence = false
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const fenceMatch = line.match(/^\s*```/)
    if (fenceMatch) {
      inCodeFence = !inCodeFence
      out.push(line)
      i++
      continue
    }

    if (inCodeFence || !looksLikeTableRow(line)) {
      out.push(line)
      i++
      continue
    }

    // 尝试收集连续的"表格行"
    const rows = []
    let j = i
    let colCount = null
    while (j < lines.length && !lines[j].match(/^\s*```/) && looksLikeTableRow(lines[j])) {
      const cols = splitColumns(lines[j].trim())
      if (colCount === null) colCount = cols.length
      if (cols.length !== colCount) break
      rows.push(cols)
      j++
    }

    if (rows.length >= 2 && colCount >= 2) {
      out.push(toMarkdownTable(rows))
      i = j
    } else {
      out.push(line)
      i++
    }
  }

  return out.join('\n')
}
