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
 * The single complete fence of `text`, or null when the text is not exactly one
 * fenced block (blank lines around it are tolerated; any real prose is not).
 * Shares splitFencedSegments' pairing rules, so a 4-backtick wrapper around
 * content that itself contains ``` is recognised as one fence, not two.
 */
export function wholeFence(text) {
  const segs = splitFencedSegments(text)
  let fence = null
  for (const seg of segs) {
    if (seg.kind === 'fence') {
      if (fence) return null
      fence = seg
    } else if (seg.text.trim() !== '') {
      return null
    }
  }
  return fence
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

  // (1) A paste that is exactly ONE complete fence — this plugin's own output
  // shape, and what "copy the block back out" produces. The type comes from the
  // fence's info string, so an explicit ```text paste is a TEXT block and
  // round-trips, instead of degrading into a bare code fence on the next send.
  const whole = wholeFence(text)
  if (whole) {
    const content = whole.body.replace(/\n+$/, '')
    if (!content) return null
    const infoLang = (whole.lang || '').toLowerCase()
    return {
      lang: infoLang === 'text' ? '' : whole.lang,
      content,
      lines: content.split(/\r?\n/),
      isCode: infoLang !== 'text',
    }
  }

  // (2) A paste that OPENS with a fence but carries trailing prose after it —
  // copying a whole previous message (fenced block + the line typed under it).
  // Keep the entire paste as ONE block so its fence pairing survives, and take
  // the type from the leading fence's info string. 0.2.5 fell through to the
  // heuristic branch here: `fenced` forced isCode = true and serializeBlock
  // re-wrapped the already-fenced text in a BARE fence, so the bubble received
  // two nested fences (with the trailing line inside the outer one) even though
  // the chip had said 文本块.
  const segs = splitFencedSegments(text)
  let leadFence = -1
  for (let i = 0; i < segs.length; i += 1) {
    if (segs[i].kind === 'fence') { leadFence = i; break }
    if (segs[i].text.trim() !== '') break
  }
  if (leadFence >= 0) {
    const leadLang = (segs[leadFence].lang || '').toLowerCase()
    const content = text.replace(/\n+$/, '')
    return {
      lang: leadLang === 'text' ? '' : segs[leadFence].lang,
      content,
      lines: content.split(/\r?\n/),
      isCode: leadLang !== 'text',
    }
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

/**
 * Backtick marker long enough to wrap `content` unambiguously: one longer than
 * the longest backtick run inside it (GFM nesting rule). Without this, content
 * that already contains a fence closes the wrapper early and the sent message
 * re-parses as several blocks — the bubble then shows the wall of text plus a
 * card built from whatever fragment happened to look like a fence.
 */
export function fenceMarkerFor(content) {
  const src = String(content == null ? '' : content)
  let longest = 0
  const runs = src.match(/`+/g)
  if (runs) for (const run of runs) if (run.length > longest) longest = run.length
  return '`'.repeat(Math.max(3, longest + 1))
}

export function serializeBlock(block) {
  const lang = block.isCode ? (block.lang || '') : 'text'
  const marker = fenceMarkerFor(block.content)
  return `\n${marker}${lang}\n${block.content}\n${marker}\n`
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

/**
 * Character ranges of every complete fence in `text`, in order, as
 * `{ start, end }` (end exclusive, covering both fence lines). Same pairing
 * rules as splitFencedSegments — index k here is the fence of the k-th fence
 * segment it returns. Used by the sent-message fold scan to tell whether a
 * fence sits inside one rendered run or straddles several.
 */
export function fenceRanges(text) {
  const src = String(text == null ? '' : text)
  const out = []
  if (!src) return out
  const starts = [0]
  for (let i = 0; i < src.length; i += 1) if (src.charCodeAt(i) === 10) starts.push(i + 1)
  const lineEnd = (n) => (n + 1 < starts.length ? starts[n + 1] - 1 : src.length)
  const lineText = (n) => src.slice(starts[n], lineEnd(n)).replace(/\r$/, '')
  const OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
  let i = 0
  while (i < starts.length) {
    const m = OPEN.exec(lineText(i))
    if (!m) { i += 1; continue }
    const marker = m[1]
    const ch = marker[0]
    const info = m[2].trim()
    if (ch === '`' && info.includes('`')) { i += 1; continue }
    const closeRe = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + marker.length + ',}[ \\t]*$')
    let j = i + 1
    let closed = false
    while (j < starts.length) {
      if (closeRe.test(lineText(j))) { closed = true; break }
      j += 1
    }
    if (!closed) { i += 1; continue }
    out.push({ start: starts[i], end: starts[j] + lineText(j).length })
    i = j + 1
  }
  return out
}

/**
 * How the sent-message fold scan should fold `text`, given the `runTexts` DSH
 * actually rendered it as. DSH splits a user message into one plain run per
 * mention chip, so a serialized block whose body mentions someone arrives as
 * several sibling runs — with the fence opener in one and its closer in
 * another, which no per-run scan can ever pair up.
 *
 * Returns null when nothing is foldable, else:
 *  - { mode: 'single', segments, runs }   every fence lies inside ONE run;
 *      `runs` lists the run indices to fold, each on its own.
 *  - { mode: 'bubble', segments, fences } a fence straddles run boundaries;
 *      the caller must rebuild the whole bubble from `segments`, because
 *      per-run folding only ever sees a broken half of the fence.
 */
export function planFoldRuns(text, runTexts) {
  const src = String(text == null ? '' : text)
  const segments = splitFencedSegments(src)
  const fenceSegs = segments.filter((seg) => seg.kind === 'fence')
  const spans = fenceRanges(src)
  if (fenceSegs.length !== spans.length) return null // defensive: keep the two walks in step
  const fences = []
  fenceSegs.forEach((seg, k) => { if (seg.body.trim() !== '') fences.push(spans[k]) })
  if (!fences.length) return null

  const bounds = []
  let at = 0
  for (const rt of (runTexts || [])) {
    const len = String(rt == null ? '' : rt).length
    bounds.push([at, at + len])
    at += len
  }
  const runOf = (off) => {
    for (let k = 0; k < bounds.length; k += 1) if (off >= bounds[k][0] && off < bounds[k][1]) return k
    return -1
  }
  const runs = []
  for (const f of fences) {
    const a = runOf(f.start)
    const b = runOf(Math.max(f.start, f.end - 1))
    if (a < 0 || a !== b) return { mode: 'bubble', segments, fences }
    if (!runs.includes(a)) runs.push(a)
  }
  return { mode: 'single', segments, runs }
}