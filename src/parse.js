/**
 * dsh-paste-code-block — pure block-parsing logic (no DOM, no DSH deps).
 *
 * Canonical source for how a pasted text/code snippet is turned into a block
 * object. The browser half (`client.js`) embeds its own copy of this logic so
 * it can run inside DSH's client module loader (which cannot `require` relative
 * ESM files); this module is the single place where that logic is unit-tested.
 *
 * Keep it framework-free and side-effect-free so it is trivially testable.
 */

const SHEBANG_LANG = {
  python: 'python', python3: 'python', node: 'javascript', nodejs: 'javascript',
  ruby: 'ruby', bash: 'bash', sh: 'bash', zsh: 'bash', dash: 'bash',
  perl: 'perl', php: 'php', go: 'go', rust: 'rust', deno: 'javascript',
}

export function detectLang(text) {
  const t = text.trim()
  const shebang = /^\s*#!\s*(?:\/usr\/(?:bin|local\/bin|sbin)\/env\s+)?([\w.-]+)/.exec(text)
  if (shebang) {
    const base = shebang[1].split('.')[0]
    if (SHEBANG_LANG[base]) return SHEBANG_LANG[base]
  }
  if (/^\s*\{(?:\s|")|\n?\s*"[\w-]+"\s*:[ \t]/.test(text) || /(?:{|\[)\s*$/.test(t)) return 'json'
  if (/^\s*<\?xml|^\s*<!DOCTYPE/.test(text)) return 'html'
  if (/^\s*</.test(t)) return 'xml'
  if (/^\s*(let|const|var)\s+\w+\s*=|function\s*\w*\s*\(|=>|class\s+\w+\s*\{/.test(t)) return 'javascript'
  if (/^\s*(import|from|export)\s+/.test(t) && /(?:;|=>|\(\))/.test(t)) return 'javascript'
  if (/^\s*(def |class \w+:|import \w+$|from \w+ import|async def )/.test(t)) return 'python'
  if (/^\s*(SELECT|INSERT INTO|CREATE TABLE|UPDATE |DELETE FROM|ALTER TABLE)\b/i.test(t)) return 'sql'
  if (/^\s*---\s*$|^\s*[a-z0-9_-]+\s*:\s*/i.test(t) && text.indexOf('\n') >= 0 && t.indexOf('=') < 0) return 'yaml'
  if (/^\s*(docker run|docker compose|FROM\s|RUN |npm run|pip install)/.test(t)) return 'bash'
  if (/^\s*(#include|int main|std::)/.test(t)) return 'cpp'
  if (/^\s*(package |import .*\n.*func )/.test(t)) return 'go'
  if (/^\s*(BEGIN|DECLARE)/i.test(t)) return 'sql'
  return ''
}

/**
 * Parse pasted text into a block, or null when it is ordinary short prose
 * that should paste plainly. `isCode` drives both the chip label (registered
 * per locale via i18n key `block.code` / `block.text` — see `src/i18n.js`)
 * and the fenced language on send.
 */
export function parseBlock(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  if (!text) return null

  const fm = /^\s*```([\w+-]*)[^\n]*\n([\s\S]*?)\n?\s*```\s*$/.exec(text)
  if (fm) {
    const lang = (fm[1] || '').trim()
    const content = fm[2].replace(/\n+$/, '')
    if (!content) return null
    return { lang, content, lines: content.split(/\r?\n/), isCode: true }
  }

  const multi = /\r?\n/.test(text)
  const long = text.length >= 96
  const fenced = /(^|\n)\s*```/m.test(text)
  if (!multi && !long && !fenced) return null

  // Markdown documents (headings, blockquotes, lists, tables, links, bold,
  // hr, task lists) read as *text*, not code. A lone "#" alone is treated as
  // a comment/code line, so only a combination of markdown signals flips it.
  const mdCount = countMarkdownSignals(text)

  const indent = text.split(/\r?\n/).some((l) => /^\s{2,}/.test(l))
  const codeKw = /^(def |function |class |const |let |var |import |from |if\b|elif\b|else\b|for\b|while\b|return\b|#include|#!|SELECT |INSERT |CREATE TABLE|UPDATE |DELETE FROM|void |public |private |package |type |enum |interface )/m.test(text)
  const dense = (text.match(/[{}()[\];]/g) || []).length >= 5
  const strongCode = fenced || codeKw || (indent && dense)

  // Markdown prose wins unless it is an actual fenced code snippet.
  const isMarkdownProse = !fenced && mdCount >= 2
  const isCode = !isMarkdownProse && strongCode

  const lang = isCode ? detectLang(text) : ''
  const content = text.replace(/\n+$/, '')
  return { lang, content, lines: content.split(/\r?\n/), isCode }
}

/**
 * Count distinct markdown structural signals. A markdown document usually
 * carries several (e.g. headings + lists + links); code with a lone "#"
 * comment carries just one and is therefore kept as code.
 */
export function countMarkdownSignals(text) {
  let n = 0
  if (/^\s{0,3}#{1,6}\s+\S/m.test(text)) n += 1            // ATX heading
  if (/^\s{0,3}>\s+/m.test(text)) n += 1                   // blockquote
  if (/^\s{0,3}([-*+]|\d{1,3}\.)\s+/m.test(text)) n += 1   // list / ordered list
  if (/\[[^\]]+\]\([^)]*\)/.test(text)) n += 1             // link
  if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(text)) n += 1     // bold
  if (/^\s*\|.*\|\s*$/m.test(text)) n += 1                 // table row
  if (/^\s*-{3,}\s*$/m.test(text)) n += 1                  // horizontal rule
  return n
}

export function serializeBlock(block) {
  const lang = block.isCode ? (block.lang || '') : 'text'
  return `\n\`\`\`${lang}\n${block.content}\n\`\`\`\n`
}

/**
 * Split a message text into ordered `prose` / `fence` segments using GFM-style
 * fenced code blocks (``` or ~~~, opening fence indented at most 3 spaces,
 * closing fence of >= the opening length and alone on its line).
 *
 * Used by the sent-message fold scanner (see design.md §12): a message the
 * plugin serialized on send comes back as fenced text inside the user
 * bubble, and this function locates the fences so each can be rendered as a
 * collapsed card while the surrounding prose stays visible.
 *
 * Returns [] for empty input. Segments:
 *  - { kind: 'prose', text }                          — verbatim lines between fences
 *  - { kind: 'fence', lang, info, body, raw }         — complete, terminated fence
 *      lang  = first word of the info string ('' when absent)
 *      info  = trimmed info string
 *      body  = content between the fence lines (no fences, verbatim)
 *      raw   = the whole slice including both fence lines
 * An unterminated opening fence (no matching close) is kept in the prose run
 * — conservative: we never fold text we are not sure ended.
 */
export function splitFencedSegments(text) {
  const src = String(text == null ? '' : text)
  if (!src) return []
  const lines = src.split(/\r?\n/)
  const segments = []
  const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
  let proseStart = 0
  let i = 0
  const flushProse = (end) => {
    if (end > proseStart) segments.push({ kind: 'prose', text: lines.slice(proseStart, end).join('\n') })
  }
  while (i < lines.length) {
    const m = OPEN.exec(lines[i])
    if (!m) { i += 1; continue }
    const marker = m[1]
    const ch = marker[0]
    const info = m[2].trim()
    // A ``` fence's info string may not contain backticks (GFM); if it does,
    // this line is ordinary prose, not an opener.
    if (ch === '`' && info.includes('`')) { i += 1; continue }
    const closeRe = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + marker.length + ',}[ \\t]*$')
    let j = i + 1
    let closed = false
    while (j < lines.length) {
      if (closeRe.test(lines[j])) { closed = true; break }
      j += 1
    }
    if (!closed) { i += 1; continue } // unterminated -> stays prose, keep scanning
    flushProse(i)
    const bodyLines = lines.slice(i + 1, j)
    segments.push({
      kind: 'fence',
      lang: info ? info.split(/\s+/)[0] : '',
      info,
      body: bodyLines.join('\n'),
      raw: lines.slice(i, j + 1).join('\n'),
    })
    i = j + 1
    proseStart = i
  }
  flushProse(lines.length)
  return segments
}