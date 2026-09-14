window.__ModuleLoader__.load({
  id: 'dsh-paste-code-block',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // ===== Constants =========================================================
    const SOURCE = 'paste-code-block'
    // Inline chip: DSH renders each reference as a Lexical chip whose host span
    // carries data-composer-chip="<source>" and, inside it, a decorator span with
    // the label as title/text. We restyle that host and hide its "@" marker.
    const MARK = 'data-dsh-pcb'
    const MARK_SESSION = 'data-dsh-pcb-session'
    const DETAIL_NS = 'dsh-pcb-detail'
    const CHIP_X_CLASS = 'dsh-pcb-chip-x'

    // ----- shared chip-DOM helpers ------------------------------------------
    // Module level on purpose: the chip sync scan and the controller's removal
    // path both need to map a chip host element back to its label (and its
    // session), and the ✕ is appended INSIDE the chip's inner span.
    function chipInner(host) { return host.querySelector(':scope > span') }
    function chipLabelText(host) {
      const inner = chipInner(host)
      if (!inner) return ''
      const title = inner.getAttribute('title')
      if (title) return title
      const spans = [...inner.querySelectorAll(':scope > span')].filter((s) => !s.classList.contains(CHIP_X_CLASS))
      const labelEl = spans[spans.length - 1]
      return (labelEl && labelEl.textContent) || inner.textContent || ''
    }
    // Resolve the active session for an element inside a composer seat.
    function sessionFor(target) {
      const seat = target.closest(`[${MARK}]`)
      let sid = seat && seat.getAttribute(MARK_SESSION)
      if (!sid && target.parentElement) {
        let el = target.parentElement
        while (el) {
          const rail = el.querySelector && el.querySelector('[data-dsh-pcb-rail]')
          if (rail) { sid = rail.getAttribute('data-dsh-pcb-session') || sid; break }
          el = el.parentElement
        }
      }
      return sid
    }

    // ----- chip node-map helpers (embedded copy of src/chip-nodes.js) --------
    // DSH renders each pasted block as a Lexical decorator chip and the input
    // shell exposes no per-reference delete verb, so removal walks the editor's
    // node map. Its VALUES ARE THE NODES THEMSELVES (Lexical >= 0.21): reading
    // `value.node` matches nothing and silently deletes nothing (v0.1.2 bug).
    function chipNodeOf(value) {
      if (!value) return null
      if (typeof value.getSource === 'function') return value
      const wrapped = value.node
      return wrapped && typeof wrapped.getSource === 'function' ? wrapped : null
    }
    function collectChipNodes(values, source, ref) {
      const hits = []
      if (!values) return hits
      for (const value of values) {
        const node = chipNodeOf(value)
        if (!node || typeof node.getReference !== 'function') continue
        if (node.getSource() === source && node.getReference() === ref) hits.push(node)
      }
      return hits
    }

    // ----- projection geometry (embedded copy of src/projection.js) ----------
    // The shell publishes clipboard coordinates (`draft`, chips expanded to their
    // clipboardText) while the scoped edit verbs address detect coordinates
    // (each chip collapses to ONE placeholder char). Convert before editing.
    function detectOffsetOf(occurrences, occ) {
      let shift = 0
      for (const other of occurrences || []) {
        if (other === occ || other.offset >= occ.offset) continue
        shift += Math.max(0, (other.length || 1) - 1)
      }
      return occ.offset - shift
    }
    // Detect span of the separator space the shell appends after a fresh chip.
    function separatorSpaceSpan(projection, occ) {
      if (!projection || !occ) return null
      const draft = projection.draft || ''
      const afterChip = occ.offset + (occ.length || 0)
      if (draft.charAt(afterChip) !== ' ') return null
      const start = detectOffsetOf(projection.occurrences, occ) + 1
      return { start, end: start + 1 }
    }

    // ===== Locale (embedded copy of src/i18n.js — keep the two in sync) =====
    const NS = 'paste-code-block'
    const L10N = {
      zh: {
        'block.code': '代码块 {n}',
        'block.text': '文本块 {n}',
        'detail.aria': '代码块详情',
        'slot.label': '粘贴代码块详情',
        'lines.one': '{count} 行',
        'lines.other': '{count} 行',
        'expand': '展开',
        'collapse': '折叠',
        'copy': '复制',
        'copied': '已复制',
        'hide': '收起',
        'remove': '移除',
        'edit.aria': '编辑代码块内容',
        'error.stale': '代码块已失效，请重新粘贴',
        'error.remove': '无法删除该块，请重试',
        'fold.code': '代码块',
        'fold.text': '文本块',
        'fold.aria': '展开或折叠该块',
      },
      en: {
        'block.code': 'Code #{n}',
        'block.text': 'Text #{n}',
        'detail.aria': 'Block details',
        'slot.label': 'Pasted block details',
        'lines.one': '{count} line',
        'lines.other': '{count} lines',
        'expand': 'Expand',
        'collapse': 'Collapse',
        'copy': 'Copy',
        'copied': 'Copied',
        'hide': 'Hide',
        'remove': 'Remove',
        'edit.aria': 'Edit block content',
        'error.stale': 'This block is no longer valid — paste it again',
        'error.remove': 'Could not remove the block — please retry',
        'fold.code': 'Code',
        'fold.text': 'Text',
        'fold.aria': 'Expand or collapse this block',
      },
    }

    function createT(locale) {
      const dict = L10N[locale] || L10N.en
      return (key, params) => {
        let text = dict[key] != null ? dict[key] : (L10N.en[key] != null ? L10N.en[key] : key)
        if (params) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
        return text
      }
    }

    // Sent-message fold card title (embedded copy of src/i18n.js#foldTitle).
    function foldTitle(t, type, lang, lines) {
      const meta = t(lines === 1 ? 'lines.one' : 'lines.other', { count: lines })
      const name = type === 'code' ? (lang || t('fold.code')) : t('fold.text')
      return `${name} · ${meta}`
    }

    function detectBrowserLocale() {
      try {
        const langs = [...(navigator.languages || []), navigator.language].filter(Boolean).map((l) => String(l).toLowerCase())
        return langs.some((l) => l.startsWith('zh')) ? 'zh' : 'en'
      } catch (e) {
        return 'en'
      }
    }

    // Pre-0.1.3 chip labels: no longer rendered, still recognized (see below).
    const LEGACY_L10N = {
      zh: { 'block.code': '复制代码块{n}', 'block.text': '复制文本块{n}' },
      en: { 'block.code': 'Code block #{n}', 'block.text': 'Text block #{n}' },
    }

    /**
     * Recognize a rendered block label in ANY shipped locale (or a pre-0.1.3
     * legacy locale) and recover its `{ type, n }` identity — this keeps chip
     * clicks, ✕ deletes, and the locale-switch retitling correct even for
     * chips inserted under a different language than the one currently
     * active. Null otherwise.
     */
    function parseBlockLabel(text) {
      if (!text) return null
      for (const dict of [L10N.zh, L10N.en, LEGACY_L10N.zh, LEGACY_L10N.en]) {
        for (const key of ['block.code', 'block.text']) {
          const pattern = new RegExp(
            '^' +
              dict[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{n\\\}/g, '(\\d+)') +
              '$',
          )
          const m = pattern.exec(text)
          if (m) return { type: key === 'block.code' ? 'code' : 'text', n: Number(m[1]) }
        }
      }
      return null
    }

    // ===== Block parsing (embedded copy of src/parse.js — keep in sync) =====
    const SHEBANG_LANG = {
      python: 'python', python3: 'python', node: 'javascript', nodejs: 'javascript',
      ruby: 'ruby', bash: 'bash', sh: 'bash', zsh: 'bash', dash: 'bash',
      perl: 'perl', php: 'php', go: 'go', rust: 'rust', deno: 'javascript',
    }

    function detectLang(text) {
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
     * that should paste plainly. `isCode` drives both the chip label
     * (i18n key `block.code` vs `block.text`, e.g. "代码块 N" / "Code #N")
     * and the fenced language on send.
     */
    function parseBlock(raw) {
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
    function countMarkdownSignals(text) {
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

    function serializeBlock(block) {
      const lang = block.isCode ? (block.lang || '') : 'text'
      return `\n\`\`\`${lang}\n${block.content}\n\`\`\`\n`
    }

    // ----- fence segmentation (embedded copy of src/parse.js) ----------------
    // Split a message text into ordered prose/fence segments (GFM-style ``` or
    // ~~~ fences, opener indented <=3 spaces, closer >= opener length alone on
    // its line). Unterminated openers stay prose. Keep in sync with parse.js.
    function splitFencedSegments(text) {
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
        if (ch === '`' && info.includes('`')) { i += 1; continue }
        const closeRe = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + marker.length + ',}[ \\t]*$')
        let j = i + 1
        let closed = false
        while (j < lines.length) {
          if (closeRe.test(lines[j])) { closed = true; break }
          j += 1
        }
        if (!closed) { i += 1; continue }
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

    // ===== Recovery mirror (draft re-seed after workspace switch / reload) ===
    // DSH persists a session's composer draft as PLAIN TEXT
    // (`dsh.conversation.<sid>` in localStorage) and re-seeds the editor from
    // it — but Lexical chip nodes cannot round-trip through text (design.md
    // §7), so switching workspaces mid-draft left every pasted block behind:
    // the seeded draft keeps only one invisible U+200B per lost chip. The
    // plugin therefore mirrors its block CONTENT to localStorage itself and
    // re-attaches the chips when it recognizes that stray-ZWSP signature
    // (BlockDock mount effect → BlockController.recover). Intentional chip
    // deletion removes the ZWSPs along with the nodes, so it never looks
    // like a re-seed; the mirror clears itself on send and once no blocks
    // remain, and stale entries expire after two weeks.
    const RECOVERY_PREFIX = 'dsh-pcb-recovery.'
    const RECOVERY_TTL_MS = 14 * 24 * 60 * 60 * 1000
    const RECOVERY_MAX_CHARS = 3_000_000
    const RECOVERY_MAX_DRAFT = 200_000

    function recoverySave(sid, blocks, draftText) {
      const key = RECOVERY_PREFIX + sid
      try {
        if (!blocks || blocks.length === 0) { localStorage.removeItem(key); return }
        const draft = typeof draftText === 'string' && draftText.length <= RECOVERY_MAX_DRAFT ? draftText : ''
        const json = JSON.stringify({ at: Date.now(), draft, blocks })
        if (json.length > RECOVERY_MAX_CHARS) { console.warn('[dsh-pcb] draft too large to mirror; chips will not survive a reload'); return }
        localStorage.setItem(key, json)
      } catch (e) { /* quota / private mode: best effort */ }
    }

    function recoveryLoad(sid) {
      const key = RECOVERY_PREFIX + sid
      try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        let data = null
        try { data = JSON.parse(raw) } catch (e) { data = null }
        if (!data || typeof data.at !== 'number' || Date.now() - data.at > RECOVERY_TTL_MS) { localStorage.removeItem(key); return null }
        return data
      } catch (e) { return null }
    }

    function recoveryClear(sid) {
      try { localStorage.removeItem(RECOVERY_PREFIX + sid) } catch (e) { /* noop */ }
    }

    /**
     * Mirror-side carry-over donor: a store whose mirrored draft matches the
     * re-seeded one exactly and still holds blocks (after a page reload there
     * is no live memory to match against). Returns { sid, blocks } on a
     * UNIQUE match, null when absent or ambiguous.
     */
    function recoveryScanDonor(targetSid, draft) {
      try {
        let hit = null
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i)
          if (!key || !key.startsWith(RECOVERY_PREFIX)) continue
          const sid = key.slice(RECOVERY_PREFIX.length)
          if (sid === targetSid) continue
          const data = recoveryLoad(sid)
          if (!data || data.draft !== draft || !Array.isArray(data.blocks)) continue
          if (!data.blocks.some((b) => b && typeof b.content === 'string' && b.content !== '')) continue
          if (hit) return null // ambiguous — refuse to guess
          hit = { sid, blocks: data.blocks }
        }
        return hit
      } catch (e) { return null }
    }

    function recoveryPruneExpired() {
      try {
        const doomed = []
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i)
          if (!k || !k.startsWith(RECOVERY_PREFIX)) continue
          let at = 0
          try { at = (JSON.parse(localStorage.getItem(k) || '{}').at) || 0 } catch (e) { /* fall through */ }
          if (!at || Date.now() - at > RECOVERY_TTL_MS) doomed.push(k)
        }
        for (const k of doomed) localStorage.removeItem(k)
      } catch (e) { /* noop */ }
    }

    // ===== Draft controller ==================================================
    class BlockController {
      /**
       * @param ctx - cordis client context (sessions/conversation services).
       * @param t - locale-bound translator, `(key, params) => string`, that
       *   reflects the ACTIVE DSH language at call time (from
       *   `ctx.locale.bind(NS)`), or the browser-guessed fallback.
       */
      constructor(ctx, t) {
        this.ctx = ctx
        this.t = t
        this.list = new Map()      // sessionId -> Block[]
        this.selected = new Map()  // sessionId -> ref
        this.used = new Map()      // sessionId -> {code:Set, text:Set}
        this.refIndex = new Map()  // ref -> {sessionId, block}
        this.labelIndex = new Map()// label (insert-time language) -> ref
        this.inFlight = new Map()
        this.expiry = new Map()
        this.serializing = new Set()
        this.listeners = new Map()
        this.recoverTimer = new Map() // sid -> debounce handle for the recovery mirror
        this.lastInput = new Map() // sid -> draft text seen by the last recover() pass
        this.counter = 0
      }

      // Per-session sets of the label numbers currently in use, split by type
      // (code vs text). Numbering always picks the smallest free integer, so
      // deleting a block frees its number for reuse (text/code counted apart).
      usedFor(sessionId) {
        const k = String(sessionId)
        let u = this.used.get(k)
        if (!u) { u = { code: new Set(), text: new Set() }; this.used.set(k, u) }
        return u
      }

      nextLabel(sessionId, type) {
        const used = this.usedFor(sessionId)[type]
        let n = 1
        while (used.has(n)) n += 1
        used.add(n)
        return n
      }

      freeLabel(sessionId, type, n) {
        const k = String(sessionId)
        const used = this.used.get(k)
        if (used) used[type]?.delete(n)
      }

      /** Current-language label for a block number, e.g. 复制代码块2 / Code block #2. */
      labelFor(block, n) {
        return this.t(block.isCode ? 'block.code' : 'block.text', { n })
      }

      listFor(sessionId) { return this.list.get(String(sessionId)) || [] }
      selectedFor(sessionId) { return this.selected.get(String(sessionId)) }

      subscribe(sessionId, fn) {
        const k = String(sessionId)
        let s = this.listeners.get(k)
        if (!s) { s = new Set(); this.listeners.set(k, s) }
        s.add(fn)
        return () => { s.delete(fn); if (s.size === 0) this.listeners.delete(k) }
      }

      publish(sessionId) {
        const s = this.listeners.get(String(sessionId))
        if (!s) return
        for (const fn of s) fn()
      }

      /**
       * Recompute every tracked block's label under the CURRENT language
       * (called when the locale snapshot changes). Keeps `labelIndex`
       * consistent and re-publishes the affected sessions so the detail card
       * re-renders; the chip DOM is synced by the client's `scanChips` pass.
       * @returns the array of `{ sessionId, block }` whose label changed.
       */
      retitleAll() {
        const changed = []
        const affected = new Set()
        for (const [k, entries] of this.list) {
          for (const block of entries) {
            const want = this.labelFor(block, block.labelNumber)
            if (want === block.label) continue
            this.labelIndex.delete(block.label)
            block.label = want
            this.labelIndex.set(want, block.id)
            changed.push({ sessionId: k, block })
            affected.add(k)
          }
        }
        for (const k of affected) this.publish(k)
        return changed
      }

      scope(sessionId) {
        const actx = this.ctx.sessions.scope(sessionId)
        if (!actx) throw new Error('paste-code-block: session not ready')
        return { actx, shell: this.ctx.conversation.input.for(actx) }
      }

      insertReference(sessionId, block) {
        const { actx, shell } = this.scope(sessionId)
        const input = shell.snapshot
        if (!input || input.phase !== 'plain') return false
        // Each chip contributes exactly one char to the editor's detect text
        // (the "￼" placeholder) and one char to the plain `draft` projection
        // (clipboardText = zero-width space, chosen because String#trim() does
        // NOT strip U+200B — so the composer's empty check `draft.trim() === ""`
        // sees the draft as non-empty and the send button stays enabled even when
        // only a block is pasted with no typed text). Hence draft.length already
        // equals the detect length; anchoring there keeps blocks strictly ordered.
        const end = input.draft ? input.draft.length : 0
        const inserted = actx.bail(actx, 'slash/input-insert-reference', {
          reference: {
            source: SOURCE,
            ref: block.id,
            label: block.label,
            clipboardText: '\u200B',
          },
          span: { start: end, end, draftRev: input.draftRev },
        }) === true
        if (!inserted) return false
        // The shell appends a separating space after the chip; creating a block
        // must not prefix the following text (or pile spaces into the draft).
        this.dropSeparatorSpace(actx, shell, block)
        return true
      }

      /**
       * Remove the separating space the shell appended after OUR freshly inserted
       * chip, and nothing else.
       *
       * `SessionInputShell.insertReference` inserts `[chip, ' ']` whenever the
       * character at the pick-time span is not itself a space. Blocks are always
       * appended at the end of the draft, so the character now sitting directly
       * after our chip can only have come from that insertion: deleting it can
       * never disturb a space the draft already had (a pre-existing trailing
       * space still sits where the user left it, before the chip).
       *
       * @param actx - session scope (scoped edit events).
       * @param shell - the session's input shell.
       * @param block - the block whose chip was just inserted.
       * @returns whether the space was removed.
       */
      dropSeparatorSpace(actx, shell, block) {
        const after = shell.snapshot
        const occ = after && (after.occurrences || []).find((o) => o.source === SOURCE && o.ref === block.id)
        const span = separatorSpaceSpan(after, occ)
        if (!span) return false
        const removed = actx.bail(actx, 'slash/input-insert-text', {
          text: '',
          span: { start: span.start, end: span.end, draftRev: after.draftRev },
        }) === true
        if (!removed) console.warn('[paste-code-block] could not drop the separator space')
        return removed
      }

      attach(sessionId, block) {
        const k = String(sessionId)
        this.clearInFlight(k)
        block.id = `${k}-${++this.counter}`
        const type = block.isCode ? 'code' : 'text'
        const n = this.nextLabel(sessionId, type)
        block.labelNumber = n
        block.type = type
        block.label = this.labelFor(block, n)
        if (!this.insertReference(sessionId, block)) {
          // release the reserved label on failure
          this.freeLabel(sessionId, type, n)
          return false
        }
        const next = [...this.listFor(k), block]
        this.list.set(k, next)
        this.refIndex.set(block.id, { sessionId: k, block })
        this.labelIndex.set(block.label, block.id)
        this.publish(sessionId)
        // The shell just rewrote the draft (chip + placeholder char); until
        // the next dock pass runs, this is the session's ground truth. Keep
        // the typing-window fingerprint and the carry-over donor match fresh
        // so the pass right after a paste cannot mistake the new draft for a
        // rebuild.
        try {
          const after = this.scope(k).shell.snapshot
          if (after && typeof after.draft === 'string') this.lastInput.set(k, after.draft)
        } catch (e) { /* session vanished — the next pass re-observes */ }
        this.mirrorNow(k) // attach is a key moment — persist synchronously
        return true
      }

      /**
       * Resolve a chip's rendered text (label in ANY locale — see
       * `parseBlockLabel`) back to its block. Prefers the insert-time label
       * index, then falls back to the (type, number) identity within the
       * chip's own session, so clicks keep working after a language switch.
       */
      blockForLabel(sessionId, label) {
        const ref = this.labelIndex.get(label)
        if (ref) {
          const record = this.refIndex.get(ref)
          if (record) return record.block
        }
        const parsed = parseBlockLabel(label)
        if (!parsed) return undefined
        return this.listFor(sessionId).find((b) => b.type === parsed.type && b.labelNumber === parsed.n)
      }

      select(sessionId, ref) {
        const k = String(sessionId)
        const cur = this.selected.get(k)
        if (cur === ref) this.selected.delete(k)
        else this.selected.set(k, ref)
        this.publish(sessionId)
      }

      /** Whether the editor's own node map still holds a chip for this ref. */
      hasChipNode(shell, ref) {
        const editor = shell && shell.editor
        if (!editor || typeof editor.getEditorState !== 'function') return false
        const state = editor.getEditorState()
        if (!state || typeof state.read !== 'function') return false
        let found = false
        state.read(() => {
          const map = state._nodeMap
          if (map && typeof map.values === 'function') found = collectChipNodes(map.values(), SOURCE, ref).length > 0
        })
        return found
      }

      /** Whether the editor still projects an occurrence (chip) for this ref. */
      hasChip(shell, ref) {
        const input = shell && shell.snapshot
        if (!input) return false
        return (input.occurrences || []).some((o) => o.source === SOURCE && o.ref === ref)
      }

      /** Whether a chip for this ref is still present (editor first, then projection). */
      chipPresent(shell, ref) {
        return this.hasChipNode(shell, ref) || this.hasChip(shell, ref)
      }

      /**
       * Remove the chip node(s) of one ref from the editor's own document.
       *
       * NEVER splice the draft via `setDraft()` to delete a chip: setDraft clears
       * the root and re-creates plain-text paragraphs, and chips are Lexical
       * decorator nodes that cannot round-trip through text — so one "spliced
       * out" chip meant EVERY block vanished (0.1.1 bug).
       *
       * The editor exposes no per-reference delete verb, so we walk its node map
       * and drop the ReferenceChipNode(s) carrying this source + ref — the same
       * `node.remove()` the editor itself performs when a chip is deleted by hand.
       *
       * @param shell - the session's input shell (exposes `.editor`).
       * @param ref - the block id to remove.
       * @returns number of nodes removed, or -1 when the editor was unreachable.
       */
      removeChipNodes(shell, ref) {
        const editor = shell && shell.editor
        if (!editor || typeof editor.update !== 'function') return -1
        let removed = 0
        try {
          editor.update(() => {
            const state = editor.getEditorState()
            const map = state ? state._nodeMap : null
            if (!map || typeof map.values !== 'function') return
            const hits = collectChipNodes(map.values(), SOURCE, ref)
            for (const node of hits) node.remove()
            removed = hits.length
          }, { discrete: true })
        } catch (err) {
          console.warn('[paste-code-block] chip node removal failed:', err)
          return -1
        }
        return removed
      }

      /**
       * Delete one block: drop its chip from the composer, then its state.
       *
       * The chip removal is VERIFIED against the editor's own node map (and, as a
       * cross-check, the published occurrence projection): if the chip is still
       * there we keep the block and surface an error rather than silently doing
       * nothing (or, worse, pruning state behind a chip that is still there).
       *
       * @param sessionId - owning session.
       * @param ref - block id.
       */
      remove(sessionId, ref) {
        const k = String(sessionId)
        const entries = this.listFor(k)
        const entry = entries.find((b) => b.id === ref)
        if (!entry) return
        const { shell } = this.scope(sessionId)
        if (this.chipPresent(shell, ref)) {
          const removed = this.removeChipNodes(shell, ref)
          if (this.chipPresent(shell, ref)) {
            console.warn('[paste-code-block] could not remove chip', { ref, removed })
            shell.notify('error', this.t('error.remove'))
            return
          }
        }
        if (this.selected.get(k) === ref) this.selected.delete(k)
        const stillListed = this.listFor(k)
        if (!stillListed.includes(entry)) return
        const next = stillListed.filter((b) => b.id !== ref)
        if (next.length > 0) this.list.set(k, next)
        else this.list.delete(k)
        this.refIndex.delete(ref)
        for (const [label, r] of this.labelIndex) if (r === ref) this.labelIndex.delete(label)
        this.freeLabel(sessionId, entry.type, entry.labelNumber)
        this.publish(sessionId)
        this.mirror(k)
      }

      /** Update a block's content while editing it in the detail card. */
      updateContent(sessionId, ref, content) {
        const record = this.refIndex.get(ref)
        if (!record) return
        record.block.content = content
        record.block.lines = content.split(/\r?\n/)
        this.mirror(record.sessionId)
      }

      clearInFlight(sessionId) {
        const k = String(sessionId)
        const expiry = this.expiry.get(k)
        if (expiry) { clearTimeout(expiry); this.expiry.delete(k) }
        const had = this.inFlight.has(k)
        for (const b of this.inFlight.get(k) || []) {
          this.refIndex.delete(b.id)
          this.freeLabel(sessionId, b.type, b.labelNumber)
          for (const [label, r] of this.labelIndex) if (r === b.id) this.labelIndex.delete(label)
        }
        this.inFlight.delete(k)
        if (had) this.mirrorNow(k)
      }

      markSerializing(ref) {
        const record = this.refIndex.get(ref)
        if (record && !this.serializing.has(record.sessionId)) {
          this.serializing.add(record.sessionId)
          // A send is starting: the content leaves the draft, the mirror may go.
          // (A failed send re-mirrors via restoreFailed.)
          recoveryClear(record.sessionId)
        }
      }

      async serialize(ref) {
        const record = this.refIndex.get(ref)
        if (!record) throw new Error(this.t('error.stale'))
        this.markSerializing(ref)
        return serializeBlock(record.block)
      }

      /**
       * Keep only blocks whose inline chip is still present in the draft (the
       * user may delete a chip with Backspace, or with the chip's ✕ button).
       * During a submit the chips may transiently vanish, so prune is deferred
       * there.
       */
      reconcile(sessionId, occurrences, phase) {
        const k = String(sessionId)
        const entries = this.listFor(k)
        if (entries.length === 0) return
        const refs = new Set((occurrences || []).filter((o) => o.source === SOURCE).map((o) => o.ref))
        const missing = entries.filter((entry) => !refs.has(entry.id))
        if (missing.length === 0) return

        if (this.serializing.delete(k)) {
          this.list.delete(k)
          this.inFlight.set(k, entries)
          const prev = this.expiry.get(k)
          if (prev) clearTimeout(prev)
          this.expiry.set(k, setTimeout(() => this.clearInFlight(k), 20_000))
          this.publish(sessionId)
          return
        }

        if (phase === 'claimed' || phase === 'settling') return

        for (const entry of missing) {
          this.refIndex.delete(entry.id)
          for (const [label, r] of this.labelIndex) if (r === entry.id) this.labelIndex.delete(label)
          if (this.selected.get(k) === entry.id) this.selected.delete(k)
          this.freeLabel(sessionId, entry.type, entry.labelNumber)
        }
        const next = entries.filter((entry) => refs.has(entry.id))
        if (next.length > 0) this.list.set(k, next)
        else this.list.delete(k)
        this.publish(sessionId)
        // Hand-deletion is final. Persist the pruned state synchronously so a
        // later reload/carry-over cannot resurrect a deleted chip from a
        // mirror the draft has already outlived — and so the recovery
        // restore-path can never fire off invisible external residue once the
        // list for this session is empty.
        this.mirrorNow(k)
      }

      restoreFailed(sessionId) {
        // Best-effort: on a failed submit, simply surface in-flight blocks again.
        // The draft chips are usually untouched on failure, so reconciliation
        // keeps them; we only re-insert markers that were consumed.
        const k = String(sessionId)
        const entries = this.inFlight.get(k) || []
        const expiry = this.expiry.get(k)
        if (expiry) { clearTimeout(expiry); this.expiry.delete(k) }
        this.inFlight.delete(k)
        const survived = []
        for (const entry of entries) {
          this.refIndex.set(entry.id, { sessionId: k, block: entry })
          this.labelIndex.set(entry.label, entry.id)
          // A chip still present in the draft is enough; skip re-insert attempt
          // if the shell can't resolve (rare). Reconcile will re-prune as needed.
          survived.push(entry)
        }
        if (survived.length) this.list.set(k, [...this.listFor(k), ...survived])
        this.publish(sessionId)
        if (survived.length) this.mirror(k)
      }

      // ----- recovery mirror -------------------------------------------------
      /** Debounced persistence of the session's current block payloads. */
      mirror(sessionId) {
        const k = String(sessionId)
        const prev = this.recoverTimer.get(k)
        if (prev) clearTimeout(prev)
        this.recoverTimer.set(k, setTimeout(() => {
          this.recoverTimer.delete(k)
          this.mirrorNow(k)
        }, 250))
      }

      mirrorNow(sessionId) {
        const k = String(sessionId)
        const t = this.recoverTimer.get(k)
        if (t) { clearTimeout(t); this.recoverTimer.delete(k) }
        recoverySave(k, this.listFor(k).map((b) => ({ isCode: !!b.isCode, lang: b.lang || '', content: b.content })), this.lastInput.get(k))
      }

      /**
       * Restore the chips a text-only draft rebuild dropped. Two DSH paths
       * strand them: (a) the persisted per-session draft re-seeds the composer
       * after a page reload, and (b) a workspace switch on the new-session
       * page CARRIES the draft plain-text to the target workspace's blank
       * session (inputHub: next.setDraft(from.snapshot.draft)) — the chips,
       * which are Lexical nodes plus controller state, never move. Both leave
       * the same signature: stray U+200Bs (every chip contributes exactly one,
       * and removing a chip removes its ZWSP too) with no live occurrence of
       * ours. Deliberate deletion therefore never looks like a rebuild; and a
       * carry-over is matched to its donor by the exact draft the donor last
       * published — unique match only, no guessing. Blocks come from memory
       * first (same tab), then this session's mirror, then the donor's memory
       * or mirror. A stray U+200B that belongs to NO restorable block is
       * ordinary invisible copy from an external app (WeChat, web pages):
       * never restorable, cosmetic — it is left exactly where the user put
       * it. Sweeping it used to rewrite the whole draft mid-typing and is
       * retired in 0.2.2 (see the typing-window guard below).
       *
       * @param sessionId - session whose composer just (re)mounted.
       * @param snapshot - live input state ({draft, occurrences, phase}).
       * @returns whether the draft was rewritten by a real restore.
       */
      recover(sessionId, snapshot) {
        const k = String(sessionId)
        if (!snapshot || typeof snapshot.draft !== 'string') return false
        const prior = this.lastInput.get(k)
        this.lastInput.set(k, snapshot.draft)
        if (this.serializing.has(k)) return false
        if (snapshot.phase && snapshot.phase !== 'plain') return false
        if ((snapshot.occurrences || []).some((o) => o.source === SOURCE)) return false
        const draft = snapshot.draft
        const strays = (draft.match(/\u200B/g) || []).length
        if (strays === 0) return false
        // Typing-window guard. Every committed keystroke re-runs this pass, so
        // a draft that MOVED since the pass before it is live typing, not a
        // text-only re-seed — and a real restore rewrites the whole document
        // via setDraft: caret to the end, chips re-appended, an in-flight IME
        // composition destroyed (0.2.2 bug: the first character typed was
        // eaten and the view bounced once, again and again). Only a draft
        // IDENTICAL to the last one observed for this session — or one this
        // page view has never seen, or only ever saw the composer hydrate
        // through while empty (fresh-boot re-seed) — can carry the rebuild
        // signature. The empty-prior escape is sealed from the other side by
        // reconcile pruning synchronously dropping the mirror: with nothing
        // restorable on record, a moved-from-empty pass restores nothing.
        if (prior && prior !== draft) return false
        let shell
        try {
          shell = this.scope(k).shell
        } catch (e) { return false } // session not ready yet — a later pass retries
        const usable = (arr) => Array.isArray(arr)
          ? arr.filter((b) => b && typeof b.content === 'string' && b.content !== '')
          : []
        let sources = usable(this.listFor(k))
        let origin = sources.length ? 'memory' : null
        let donor = null
        if (!sources.length) {
          const saved = recoveryLoad(k)
          sources = usable(saved && saved.blocks)
          if (sources.length) origin = 'mirror'
        }
        if (!sources.length) {
          donor = this.findCarryoverSource(k, draft)
          if (donor) {
            sources = usable(this.listFor(donor))
            origin = 'carry-over (live)'
          }
        }
        if (!sources.length) {
          const scanned = recoveryScanDonor(k, draft)
          if (scanned && scanned.blocks.length) {
            donor = scanned.sid
            sources = usable(scanned.blocks)
            origin = 'carry-over (mirror)'
          }
        }
        if (sources.length === 0) {
          // Nothing to restore — invisible external residue (or the residue of
          // a deliberately deleted chip whose node already carries none of our
          // state). NEVER rewrite the draft for it: rewriting drops the caret,
          // destroys an in-flight IME composition and re-seeds stale text over
          // whatever the user typed in the meantime (0.2.2).
          return false
        }
        try {
          shell.setDraft(draft.replace(/\u200B/g, ''))
        } catch (e) {
          console.warn('[dsh-pcb] recovery: draft rewrite failed', e)
          return false
        }
        // The draft — and with it the blocks — now belongs to this session:
        // forget the (possibly moved) bookkeeping; attach() re-derives ids,
        // labels and numbers, and re-mirrors under this sid.
        this.forgetSession(k)
        if (donor) {
          this.forgetSession(donor)
          recoveryClear(donor)
          this.lastInput.delete(donor)
        }
        let restored = 0
        for (const b of sources) {
          const block = { lang: b.lang || '', content: b.content, lines: b.content.split(/\r?\n/), isCode: !!b.isCode }
          if (this.attach(k, block)) restored += 1
        }
        console.log('[dsh-pcb] recovery: re-attached', restored, 'of', sources.length, 'block(s) via', origin, donor ? `(donor ${donor})` : '')
        return restored > 0
      }

      /** Unmounted session that still lists blocks and last published EXACTLY this draft. */
      findCarryoverSource(targetSid, draft) {
        let found = null
        for (const [x, entries] of this.list) {
          if (x === targetSid || entries.length === 0) continue
          if (this.serializing.has(x)) continue
          const listeners = this.listeners.get(x)
          if (listeners && listeners.size > 0) continue // still mounted — draft did not move
          if (this.lastInput.get(x) !== draft) continue
          if (found) return null // ambiguous
          found = x
        }
        return found
      }

      /** Drop a session's block bookkeeping (its chips are gone or moving). */
      forgetSession(sessionId) {
        const k = String(sessionId)
        for (const b of this.listFor(k)) {
          this.freeLabel(k, b.type, b.labelNumber)
          this.refIndex.delete(b.id)
          for (const [label, r] of this.labelIndex) if (r === b.id) this.labelIndex.delete(label)
        }
        this.list.delete(k)
        this.selected.delete(k)
      }

      dispose() {
        for (const t of this.expiry.values()) clearTimeout(t)
        for (const t of this.recoverTimer.values()) clearTimeout(t)
        this.recoverTimer.clear()
        this.expiry.clear(); this.list.clear(); this.selected.clear()
        this.used.clear(); this.refIndex.clear(); this.labelIndex.clear()
        this.inFlight.clear(); this.serializing.clear(); this.listeners.clear()
      }
    }

    // ===== React glue ========================================================
    function useBlocks(controller, sessionId) {
      const [, render] = React.useState(0)
      React.useEffect(
        () => controller.subscribe(sessionId, () => render((v) => v + 1)),
        [controller, sessionId],
      )
      return controller.listFor(sessionId)
    }

    function useSelectedBlock(controller, sessionId) {
      const [, render] = React.useState(0)
      React.useEffect(
        () => controller.subscribe(sessionId, () => render((v) => v + 1)),
        [controller, sessionId],
      )
      const ref = controller.selectedFor(sessionId)
      if (!ref) return null
      const record = controller.refIndex.get(ref)
      return record ? record.block : null
    }

    function useComposerMark(rootRef, sessionId, draftRev, active) {
      React.useLayoutEffect(() => {
        const root = rootRef.current
        if (!root) return
        let el = root.parentElement
        while (el) {
          if (el.nodeType === 1 && el.querySelector && el.querySelector('textarea,[contenteditable],[role="textbox"]')) break
          el = el.parentElement
        }
        if (!el) return
        el.setAttribute(MARK, '1')
        el.setAttribute(MARK_SESSION, String(sessionId))
        // Invisible block markers can leave the draft reading as "empty", so the
        // composer's own placeholder would otherwise sit on top of the chips.
        el.setAttribute('data-dsh-pcb-active', active ? '1' : '0')
      }, [sessionId, draftRev, active])
    }

    // ===== Render: the small inline chips are DSH's own; we style them via CSS. =====
    // This dock renders a **detail card only for the selected block** (clicked chip).
    function BlockDock(props) {
      const input = props.useInput((state) => state) || {}
      const promptError = props.useSession((session) => session.promptError) || null
      const blocks = useBlocks(props.controller, props.sessionId)
      const selected = useSelectedBlock(props.controller, props.sessionId)
      const railRef = React.useRef(null)
      // `props.t` is the slot's locale seat (a fresh reference on every locale
      // revision, and the outlet re-renders with it); the controller's
      // translator is the defensive fallback for non-locale compositions.
      const t = props.t || props.controller.t

      useComposerMark(railRef, props.sessionId, input.draftRev, blocks.length > 0)

      React.useEffect(() => {
        // Recognize a text-only draft re-seed (workspace switch / reload)
        // FIRST: re-attach lost chips before reconciliation prunes them. A
        // successful recovery mutates the draft, so this pass must NOT
        // reconcile against its now-stale snapshot — the next draftRev pass
        // does that with fresh occurrences.
        if (props.controller.recover(props.sessionId, input)) return
        props.controller.reconcile(props.sessionId, input.occurrences || [], input.phase)
      }, [props.controller, props.sessionId, input.draftRev, input.phase])

      React.useEffect(() => {
        if (promptError && props.controller.inFlight.has(String(props.sessionId))) {
          props.controller.restoreFailed(props.sessionId)
        }
      }, [props.controller, props.sessionId, promptError])

      // Re-sync the chip DOM (localized titles, ✕ buttons) after every dock
      // render — covers attach, removal, selection, and locale switches.
      React.useEffect(() => { props.syncChips() })

      const empty = !selected
      return React.createElement(
        'div',
        {
          ref: railRef,
          className: `dsh-pcb-dock${empty ? ' dsh-pcb-dock--empty' : ''}`,
          'data-dsh-pcb-rail': '',
          'data-dsh-pcb-session': String(props.sessionId),
          'aria-label': t('detail.aria'),
        },
        selected
          ? React.createElement(BlockDetail, {
              block: selected,
              controller: props.controller,
              sessionId: props.sessionId,
              t,
            })
          : null,
      )
    }

    function BlockDetail(props) {
      const { block, controller, sessionId, t } = props
      const [collapsed, setCollapsed] = React.useState(false)
      const [copied, setCopied] = React.useState(false)
      // Editable draft: lets the user edit the block's content in the detail
      // card; kept in local state (so the caret isn't disturbed) and mirrored to
      // the controller so the serialized send uses the edited text.
      const [draft, setDraft] = React.useState(block.content)

      React.useEffect(() => {
        setDraft(block.content)
      }, [block.id])

      function onEdit(ev) {
        const value = ev.target.value
        setDraft(value)
        controller.updateContent(sessionId, block.id, value)
      }

      function copy() {
        navigator.clipboard?.writeText(block.content)?.then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }).catch(() => {})
      }

      function hide() {
        controller.select(sessionId, block.id) // toggles off (same id)
      }

      const lineCount = block.lines.length
      return React.createElement(
        'div',
        { className: `dsh-pcb-detail${collapsed ? ' dsh-pcb-detail--collapsed' : ''}` },
        React.createElement(
          'div',
          { className: 'dsh-pcb-head' },
          React.createElement('span', { className: 'dsh-pcb-lang' }, block.lang || 'text'),
          React.createElement('span', { className: 'dsh-pcb-lines' }, t(lineCount === 1 ? 'lines.one' : 'lines.other', { count: lineCount })),
          React.createElement('span', { className: 'dsh-pcb-spacer' }),
          collapsed ? React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: t('expand'), 'aria-label': t('expand'),
            onClick: () => setCollapsed(false),
          }, '▾') : React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: t('collapse'), 'aria-label': t('collapse'),
            onClick: () => setCollapsed(true),
          }, '▸'),
          React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: copied ? t('copied') : t('copy'), 'aria-label': t('copy'),
            onClick: copy,
          }, copied ? '✓' : '⎘'),
          React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: t('hide'), 'aria-label': t('hide'),
            onClick: hide,
          }, '⟨'),
          React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn dsh-pcb-btn--danger', title: t('remove'), 'aria-label': t('remove'),
            onClick: () => controller.remove(sessionId, block.id),
          }, '×'),
        ),
        collapsed
          ? React.createElement('div', { className: 'dsh-pcb-preview' }, block.lines.slice(0, 1).join('\n'))
          : React.createElement('textarea', {
              className: 'dsh-pcb-body dsh-pcb-body--edit',
              value: draft,
              onChange: onEdit,
              spellCheck: false,
              rows: Math.min(Math.max(block.lines.length, 2), 12),
              'aria-label': t('edit.aria'),
            }),
      )
    }

    // ===== Sent-message fold =================================================
    // A block that folded in the composer comes back *after send* as fenced
    // text inside the user bubble (DSH renders user messages as plain
    // pre-wrap runs), so the wall of text this plugin exists to prevent
    // reappears in the transcript. scanFolds() (see apply) walks sent
    // bubbles and folds every complete fenced block into a collapsed card:
    //   [</>] python · 128 行        [⎘] ▾      (header click toggles)
    // React owns the bubble's own children, so nothing is removed or
    // reordered: the plainRun span being folded is hidden (display:none) and
    // a host element we fully own is inserted directly after it. A content
    // stamp on the run keeps the scan idempotent and self-refreshing — text
    // or locale revision changes rebuild the host, and a fold that becomes
    // unnecessary is undone. The copy button copies the RAW fenced text
    // (exactly what was sent); the bubble's own copy/edit/delete bar is
    // React-side and never sees this DOM.
    const FOLD_HOST_CLASS = 'dsh-pcb-fold-host'
    const FOLD_CARD_CLASS = 'dsh-pcb-fold'
    const FOLD_RUN_ATTR = 'data-dsh-pcb-run'      // '1|<stamp>' folded · '0|<stamp>' checked, plain
    const FOLD_STAMP_ATTR = 'data-dsh-pcb-stamp'  // on the host, matches the run's stamp
    const FOLD_BUBBLE_SEL = [
      '[data-chat-flow-kind="user"]',
      '[data-chat-flow-kind="steering"]',
      '[data-submission-echo]',
      '[data-pending-steering]',
    ].map((s) => `${s} [class*="bubble"]`).join(',')
    const foldOpenKeys = new Set() // user-toggled-open cards, stable across rebuilds
    let foldRev = 0                // bumped on locale switch so cards re-title

    function hash32(str) {
      let h = 0x811c9dc5
      for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
      }
      return (h >>> 0).toString(36)
    }

    function foldStamp(text) {
      return `${foldRev}:${text.length}:${hash32(text)}`
    }

    // Cheap pre-filter so the per-frame scan stays trivial on unfenced runs.
    const FENCE_HINT = /(^|\n) {0,3}(```|~~~)/

    function isFoldRun(el) {
      return el.tagName === 'SPAN' && (el.getAttribute('class') || '').includes('plainRun')
    }

    /** Segments when the text holds at least one non-empty complete fence, else null. */
    function foldPlanFor(text) {
      if (!FENCE_HINT.test(text)) return null
      const segments = splitFencedSegments(text)
      let folds = 0
      for (const seg of segments) if (seg.kind === 'fence' && seg.body.trim() !== '') folds += 1
      return folds > 0 ? segments : null
    }

    function buildFoldCard(seg, openKey, t) {
      const infoLang = (seg.lang || '').toLowerCase()
      // Only an EXPLICIT ```text fence is a text block. The composer never
      // emits a bare fence for prose (plain blocks always serialize as
      // ```text), so a bare ``` fence is code whose language the composer
      // could not name — fold it as a code card and re-guess the language
      // for display. (0.2.0 bug: bare fences folded as 文本块, mismatching
      // the 代码块 chip the message was drafted from.)
      const isText = infoLang === 'text'
      const lang = isText ? '' : (infoLang || detectLang(seg.body) || '')
      const type = isText ? 'text' : 'code'
      const lines = seg.body.split('\n').length
      const open = foldOpenKeys.has(openKey)

      const card = document.createElement('div')
      card.className = FOLD_CARD_CLASS
      card.setAttribute('data-pcb-type', type)
      card.setAttribute('data-open', open ? '1' : '0')

      const head = document.createElement('div')
      head.className = 'dsh-pcb-fold-head'

      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'dsh-pcb-fold-toggle'
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
      toggle.setAttribute('aria-label', t('fold.aria'))
      toggle.title = t(open ? 'collapse' : 'expand')
      const glyph = document.createElement('span')
      glyph.className = 'dsh-pcb-fold-glyph'
      glyph.setAttribute('aria-hidden', 'true')
      glyph.textContent = type === 'code' ? '</>' : 'Aa'
      const title = document.createElement('span')
      title.className = 'dsh-pcb-fold-title'
      title.textContent = foldTitle(t, type, lang, lines)
      const chevron = document.createElement('span')
      chevron.className = 'dsh-pcb-fold-chevron'
      chevron.setAttribute('aria-hidden', 'true')
      chevron.textContent = '▾'
      toggle.append(glyph, title, chevron)

      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'dsh-pcb-btn dsh-pcb-fold-copy'
      copy.title = t('copy')
      copy.setAttribute('aria-label', t('copy'))
      copy.textContent = '⎘'
      let copyTimer = 0
      copy.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        try {
          const done = navigator.clipboard?.writeText(seg.raw)
          if (done && typeof done.then === 'function') {
            done.then(() => {
              copy.textContent = '✓'
              clearTimeout(copyTimer)
              copyTimer = setTimeout(() => { copy.textContent = '⎘' }, 1200)
            }, () => {})
          }
        } catch (e) { /* noop */ }
      })

      head.append(toggle, copy)
      const pre = document.createElement('pre')
      pre.className = 'dsh-pcb-fold-body'
      pre.textContent = seg.body
      card.append(head, pre)

      toggle.addEventListener('click', (ev) => {
        ev.preventDefault()
        ev.stopPropagation()
        const nowOpen = card.getAttribute('data-open') !== '1'
        card.setAttribute('data-open', nowOpen ? '1' : '0')
        toggle.setAttribute('aria-expanded', nowOpen ? 'true' : 'false')
        toggle.title = t(nowOpen ? 'collapse' : 'expand')
        if (nowOpen) foldOpenKeys.add(openKey)
        else foldOpenKeys.delete(openKey)
      })
      return card
    }

    function buildFoldHost(segments, keyBase, t) {
      const host = document.createElement('div')
      host.className = FOLD_HOST_CLASS
      segments.forEach((seg, i) => {
        if (seg.kind === 'fence' && seg.body.trim() !== '') {
          host.appendChild(buildFoldCard(seg, `${keyBase}:${i}`, t))
        } else {
          const prose = document.createElement('span')
          prose.className = 'dsh-pcb-fold-prose'
          // An un-foldable fence (empty body) keeps its raw text, fences and all.
          prose.textContent = seg.kind === 'fence' ? seg.raw : seg.text
          host.appendChild(prose)
        }
      })
      return host
    }

    // ===== Styles ============================================================
    const CSS = `
      /* --- restyle DSH's inline reference chip into a boxed badge --- */
      [data-composer-chip="${SOURCE}"] > span{
        box-sizing:border-box!important;display:inline-flex!important;align-items:center;
        gap:4px!important;vertical-align:middle;margin:0 2px;padding:1px 8px!important;
        border:1px solid var(--dsw-alias-border-l3)!important;border-radius:7px!important;
        background:var(--dsw-specific-input-major,var(--dsw-alias-interactive-bg-hover))!important;
        color:var(--dsw-alias-label-primary)!important;
        font-family:var(--dsw-font-family)!important;font-size:12px!important;line-height:18px!important;
        cursor:pointer;box-shadow:var(--dsw-shadow-lv1);min-width:0;max-width:100%;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap
      }
      [data-composer-chip="${SOURCE}"]:hover > span{
        border-color:var(--dsw-alias-state-business-primary)!important;
        background:var(--dsw-alias-interactive-bg-hover)!important
      }
      /* hide the "@" marker that DSH renders when the chip has no appearance glyph */
      [data-composer-chip="${SOURCE}"] > span > [aria-hidden="true"]{display:none!important}
      /* the label text (the trailing ✕ element is ours — never ellipsis it) */
      [data-composer-chip="${SOURCE}"] > span > span:not(.${CHIP_X_CLASS}){font-weight:500!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

      /* --- type identity: leading glyph + tint (data-pcb-type set by scanChips) --- */
      [data-composer-chip="${SOURCE}"][data-pcb-type="code"] > span{
        border-color:var(--dsh-pcb-code-border,rgba(76,110,245,.38))!important;
        background:var(--dsh-pcb-code-bg,rgba(76,110,245,.09))!important;
        color:var(--dsw-alias-state-business-primary,#4c6ef5)!important
      }
      [data-composer-chip="${SOURCE}"][data-pcb-type="code"]:hover > span{
        border-color:var(--dsw-alias-state-business-primary,#4c6ef5)!important;
        background:var(--dsh-pcb-code-bg-hover,rgba(76,110,245,.16))!important
      }
      [data-composer-chip="${SOURCE}"][data-pcb-type="code"] > span::before{
        content:'</>';flex:none;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);
        font-size:10px;font-weight:700;line-height:16px;opacity:.9
      }
      [data-composer-chip="${SOURCE}"][data-pcb-type="text"] > span::before{
        content:'Aa';flex:none;font-size:10px;font-weight:700;line-height:16px;
        letter-spacing:.2px;color:var(--dsw-alias-label-tertiary)
      }

      /* --- per-chip ✕ delete button (element we own, appended inside the chip) --- */
      .${CHIP_X_CLASS}{
        box-sizing:border-box;flex:none;width:16px;height:16px;display:inline-grid;place-items:center;
        margin-left:2px;border-radius:5px;font-size:13px;line-height:1;font-weight:600;
        color:var(--dsw-alias-label-tertiary);cursor:pointer;user-select:none
      }
      .${CHIP_X_CLASS}:hover{
        background:var(--dsw-alias-interactive-bg-hover-danger,rgba(224,49,49,.12));
        color:var(--dsw-alias-state-error-primary,#e03131)
      }

      /* --- dock / detail card above the input --- */
      .dsh-pcb-dock{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);margin:0 auto 6px;padding:0 var(--dsh-composer-side-clearance,16px);display:flex;flex-direction:column;gap:8px}
      .dsh-pcb-dock--empty{display:none}
      .dsh-pcb-detail{box-sizing:border-box;width:100%;min-width:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-input-major);box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-label-primary);overflow:hidden}
      .dsh-pcb-head{box-sizing:border-box;height:32px;flex:none;display:flex;align-items:center;gap:8px;padding:0 6px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l2)}
      .dsh-pcb-lang{flex:none;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-state-business-primary,#4c6ef5);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:1px 7px}
      .dsh-pcb-lines{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .dsh-pcb-spacer{flex:1;min-width:0}
      .dsh-pcb-btn{box-sizing:border-box;width:26px;height:26px;flex:none;display:grid;place-items:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;cursor:pointer}
      .dsh-pcb-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
      .dsh-pcb-btn--danger:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
      .dsh-pcb-preview{box-sizing:border-box;padding:6px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
      .dsh-pcb-body{box-sizing:border-box;margin:0;max-height:260px;overflow:auto;padding:8px 12px;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:1.5;white-space:pre;word-break:break-all;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)}
      .dsh-pcb-body--edit{display:block;width:100%;min-height:56px;max-height:300px;resize:vertical;border:0;outline:none;border-radius:0;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);white-space:pre;overflow:auto;cursor:text}
      .dsh-pcb-body--edit:focus{outline:1px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}

      /* --- hide the composer's own placeholder while chips/cards are active --- */
      [data-dsh-pcb-active="1"] [data-composer-placeholder]{visibility:hidden}

      /* --- sent-message fold cards (conversation bubbles) --- */
      .dsh-pcb-fold-host{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;min-width:0}
      .dsh-pcb-fold-prose{white-space:pre-wrap;word-break:break-word}
      .dsh-pcb-fold{box-sizing:border-box;width:100%;min-width:0;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-specific-input-major,var(--dsw-alias-bg-layer-1));box-shadow:var(--dsw-shadow-lv1);color:var(--dsw-alias-label-primary);overflow:hidden}
      .dsh-pcb-fold-head{box-sizing:border-box;min-height:34px;flex:none;display:flex;align-items:center;gap:4px;padding:0 6px 0 10px}
      .dsh-pcb-fold-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:7px;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
      .dsh-pcb-fold-glyph{flex:none;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:11px;font-weight:700;line-height:16px;opacity:.9}
      .dsh-pcb-fold[data-pcb-type="code"] .dsh-pcb-fold-glyph{color:var(--dsw-alias-state-business-primary,#4c6ef5)}
      .dsh-pcb-fold[data-pcb-type="text"] .dsh-pcb-fold-glyph{color:var(--dsw-alias-label-tertiary)}
      .dsh-pcb-fold-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
      .dsh-pcb-fold[data-pcb-type="text"] .dsh-pcb-fold-title{font-family:var(--dsw-font-family)}
      .dsh-pcb-fold-chevron{flex:none;width:14px;text-align:center;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:transform .14s ease}
      .dsh-pcb-fold[data-open="1"] .dsh-pcb-fold-chevron{transform:rotate(180deg)}
      .dsh-pcb-fold[data-open="0"] .dsh-pcb-fold-body{display:none}
      .dsh-pcb-fold-body{box-sizing:border-box;margin:0;max-height:360px;overflow:auto;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2);font-family:var(--dsw-font-mono,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:1.5;white-space:pre;word-break:break-all;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)}

      @media (max-width:640px){
        .dsh-pcb-head{height:34px}
        .dsh-pcb-lang{max-width:55%}
        .dsh-pcb-fold-body{max-height:240px}
      }
      @media (pointer:coarse){
        .${CHIP_X_CLASS}{width:22px;height:22px;font-size:15px}
      }
    `

    // ===== Client plugin body ===============================================
    const inject = ['slots', 'sessions', 'conversation', 'inputTriggers', 'locale']

    function apply(ctx) {
      // Bump alongside package.json on every release — the load log is the
      // only proof of WHICH bundle generation the browser actually loaded.
      try { console.log('[dsh-paste-code-block] client loaded v0.2.3') } catch (e) { /* noop */ }

      // Publish our dictionaries under the plugin namespace, then bind a
      // translator that always reflects the ACTIVE DSH language (Settings →
      // Language, or its browser fallback). Outside a composition that carries
      // the locale plugin we degrade to a browser-language guess.
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, L10N), 'paste-code-block: dictionaries')
      }
      const t = (ctx.locale && typeof ctx.locale.bind === 'function')
        ? ctx.locale.bind(NS)
        : createT(detectBrowserLocale())

      const controller = new BlockController(ctx, t)
      // Test seam (tests/fold-smoke.test.js drives recover() directly).
      exports.__controllerForTests = controller
      ctx.effect(() => () => controller.dispose(), 'paste-code-block: state')
      try { recoveryPruneExpired() } catch (e) { /* private mode: recovery simply off */ }

      // ----- chip DOM sync: localized labels + per-chip ✕ delete button -----
      function scanChips() {
        if (typeof document === 'undefined') return
        if (controller.list.size === 0) return
        const hosts = document.querySelectorAll(`[data-composer-chip="${SOURCE}"]`)
        for (const host of hosts) {
          const inner = chipInner(host)
          if (!inner) continue
          const parsed = parseBlockLabel(inner.getAttribute('title') || '') || parseBlockLabel(chipLabelText(host))
          if (!parsed) continue
          const seat = host.closest(`[${MARK_SESSION}]`)
          const sid = seat && seat.getAttribute(MARK_SESSION)
          if (!sid) continue
          const block = controller.listFor(sid).find((b) => b.type === parsed.type && b.labelNumber === parsed.n)
          if (!block) continue
          // Tag the chip host with its type so CSS can render the leading
          // glyph and tint (code = blue `</>`, text = neutral `Aa`).
          if (host.getAttribute('data-pcb-type') !== parsed.type) {
            host.setAttribute('data-pcb-type', parsed.type)
          }
          // Retitle the chip to the current language. Lexical caches the
          // insert-time label inside the node, so on a Settings → Language
          // switch (or a chip that remounted with the old label) the DOM is
          // the sync surface; React's own diff never touches these nodes
          // again while the node state is unchanged.
          if (inner.getAttribute('title') !== block.label) {
            inner.setAttribute('title', block.label)
            const spans = [...inner.querySelectorAll(':scope > span')].filter((s) => !s.classList.contains(CHIP_X_CLASS))
            const labelEl = spans[spans.length - 1]
            if (labelEl && labelEl.textContent !== block.label) labelEl.textContent = block.label
          }
          // Ensure the ✕ delete affordance exists on this chip.
          let x = inner.querySelector(`:scope > .${CHIP_X_CLASS}`)
          if (!x) {
            x = document.createElement('span')
            x.className = CHIP_X_CLASS
            x.textContent = '×'
            x.setAttribute('role', 'button')
            x.setAttribute('tabindex', '-1')
            inner.appendChild(x)
          }
          const tip = t('remove')
          if (x.getAttribute('aria-label') !== tip) {
            x.setAttribute('aria-label', tip)
            x.setAttribute('title', tip)
          }
        }
      }

      // ----- sent-message fold: the scan ------------------------------------
      function foldRun(run, plan, keyBase, stamp) {
        run.setAttribute(FOLD_RUN_ATTR, `1|${stamp}`)
        run.style.display = 'none'
        const next = run.nextElementSibling
        if (next && next.classList.contains(FOLD_HOST_CLASS)) {
          if (next.getAttribute(FOLD_STAMP_ATTR) === stamp) return // already current
          next.remove()
        }
        const host = buildFoldHost(plan, keyBase, t)
        host.setAttribute(FOLD_STAMP_ATTR, stamp)
        run.insertAdjacentElement('afterend', host)
      }

      /** Restore a previously folded run to DSH's own rendering. */
      function unfoldRun(run, stamp) {
        const next = run.nextElementSibling
        if (next && next.classList.contains(FOLD_HOST_CLASS)) next.remove()
        run.style.display = ''
        run.setAttribute(FOLD_RUN_ATTR, `0|${stamp}`)
      }

      function scanFolds() {
        if (typeof document === 'undefined') return
        let bubbles
        try { bubbles = document.querySelectorAll(FOLD_BUBBLE_SEL) } catch (e) { return }
        for (const bubble of bubbles) {
          if (!bubble.isConnected) continue
          const holder = bubble.closest('[data-chat-flow-key]')
          const flowKey = holder ? holder.getAttribute('data-chat-flow-key') || '' : ''
          const kids = [...bubble.children]
          for (let i = 0; i < kids.length; i += 1) {
            const el = kids[i]
            if (el.classList.contains(FOLD_HOST_CLASS)) continue
            if (!isFoldRun(el)) continue
            const text = el.textContent || ''
            const stamp = foldStamp(text)
            const marked = el.getAttribute(FOLD_RUN_ATTR) || ''
            if (marked === `1|${stamp}` || marked === `0|${stamp}`) continue // current
            const plan = foldPlanFor(text)
            if (!plan) {
              if (marked.startsWith('1|')) unfoldRun(el, stamp)
              else el.setAttribute(FOLD_RUN_ATTR, `0|${stamp}`)
              continue
            }
            // Echo/pending rows have no flow key — fall back to a content hash so
            // two simultaneous unkeyed rows never share one open-state slot.
            const keyBase = `${flowKey || 'h' + hash32(text)}#${i}`
            foldRun(el, plan, keyBase, stamp)
          }
          // Drop orphan hosts (e.g. React remounted the run span underneath us).
          for (const el of [...bubble.children]) {
            if (!el.classList.contains(FOLD_HOST_CLASS)) continue
            const prev = el.previousElementSibling
            const mark = prev && prev.getAttribute ? prev.getAttribute(FOLD_RUN_ATTR) : null
            const keep = !!mark && mark.startsWith('1|') &&
              prev.style.display === 'none' &&
              el.getAttribute(FOLD_STAMP_ATTR) === mark.slice(2)
            if (!keep) el.remove()
          }
        }
      }

      let scanScheduled = 0
      function scheduleScan() {
        if (scanScheduled) return
        const run = () => { scanScheduled = 0; scanChips(); scanFolds() }
        scanScheduled = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)
      }

      ctx.effect(() => {
        if (typeof MutationObserver === 'undefined' || !document.body) return undefined
        const mo = new MutationObserver(scheduleScan)
        mo.observe(document.body, { childList: true, subtree: true })
        return () => mo.disconnect()
      }, 'paste-code-block: chip sync observer')

      // A locale switch (or a late dictionary registration bumps the revision
      // too) re-derives labels: controller state first, chip DOM second. Sent
      // fold cards are rebuilt the same way — bumping foldRev invalidates
      // every run stamp, so the next scan re-titles the cards in the new
      // language while foldOpenKeys keeps who was expanded.
      ctx.effect(() => {
        const face = ctx.locale
        if (!face || typeof face.subscribe !== 'function') return undefined
        return face.subscribe(() => { controller.retitleAll(); foldRev += 1; scheduleScan() })
      }, 'paste-code-block: locale sync')
      scheduleScan() // late-mount safety for chips and sent bubbles rendered before plugin boot

      // On dispose (plugin removed / HMR swap) hand the transcript back to DSH.
      ctx.effect(() => () => {
        try {
          for (const host of document.querySelectorAll(`.${FOLD_HOST_CLASS}`)) host.remove()
          for (const run of document.querySelectorAll(`[${FOLD_RUN_ATTR}]`)) {
            run.style.display = ''
            run.removeAttribute(FOLD_RUN_ATTR)
          }
        } catch (e) { /* noop */ }
        foldOpenKeys.clear()
      }, 'paste-code-block: fold restore')

      ctx.effect(() => ctx.inputTriggers.registerSource({
        trigger: '@',
        name: SOURCE,
        order: 20_000,
        candidates: async () => [],
        onPick: () => undefined,
        codec: {
          clipboardText: () => '',
          serialize: async (ref) => controller.serialize(ref),
        },
      }), 'paste-code-block: hidden reference codec')

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-paste-code-block'
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'paste-code-block: styles')

      // Paste-storm guard (0.2.3). External automation — a Tampermonkey
      // AutoClicker, a clipboard bridge, IME glue, or a held-down Ctrl+V —
      // can re-dispatch the SAME clipboard text dozens of times a second.
      // Each accepted paste mints a new block, drags the caret to the draft
      // end and re-renders the dock: that is the "the page jumps and my
      // first typed character vanishes, and it keeps showing these" report,
      // with the composer left stuffed with duplicate chips. Collapse runs
      // of an identical clipboard text that arrive faster than a human can
      // act into a single paste; anything spaced beyond the window is
      // honored normally.
      const STORM_WINDOW_MS = 500
      const pasteStorm = {
        lastText: '',
        lastAt: 0,
        // True when this text is the tail of a storm; every call refreshes
        // the window, so a held repeat stays suppressed while it continues.
        seen(text, now) {
          const dup = text === this.lastText && now - this.lastAt < STORM_WINDOW_MS
          this.lastText = text
          this.lastAt = now
          return dup
        },
      }
      exports.__pasteStormForTests = pasteStorm

      // Turn qualifying pastes into boxed inline chips.
      const onPaste = (ev) => {
        const clip = ev.clipboardData
        if (!clip) return
        const text = clip.getData('text/plain')
        if (!text || text.length === 0) return
        const target = document.activeElement
        if (!target || !(target instanceof Element)) return
        const sid = sessionFor(target)
        if (!sid) return
        const block = parseBlock(text)
        if (!block) { console.log('[dsh-paste-code-block] paste NOT block', text.length); return }
        if (pasteStorm.seen(text, Date.now())) {
          // Consume the event (never let the raw text fall through to the
          // composer) but create nothing.
          ev.preventDefault()
          ev.stopPropagation()
          console.log('[dsh-paste-code-block] storm paste ignored (<' + STORM_WINDOW_MS + 'ms repeat)')
          return
        }
        console.log('[dsh-paste-code-block] intercept', block.isCode ? 'code' : 'text', block.lines.length, 'lang=', block.lang)
        ev.preventDefault()
        ev.stopPropagation()
        try {
          if (!controller.attach(sid, block)) {
            console.log('[dsh-paste-code-block] attach failed; plain insert instead')
            const { actx, shell } = controller.scope(sid)
            const input = shell.snapshot
            if (input && actx.bail(actx, 'slash/input-insert-text', {
              text: text + (text.endsWith('\n') ? '' : '\n'),
              span: {
                start: input.draft ? input.draft.length : 0,
                end: input.draft ? input.draft.length : 0,
                draftRev: input.draftRev,
              },
            }) !== true) {
              console.warn('[dsh-paste-code-block] could not insert block text')
            }
          }
        } catch (err) {
          console.error('[paste-code-block] attach failed:', err)
        }
      }
      ctx.effect(() => {
        document.addEventListener('paste', onPaste, true)
        return () => document.removeEventListener('paste', onPaste, true)
      }, 'paste-code-block: paste capture')

      // Chip interactions: ✕ deletes the block, a body click toggles its card;
      // any other click dismisses the open card.
      const onChipPointer = (ev) => {
        const target = ev.target
        if (!(target instanceof Element)) return
        // ✕ on a chip: remove that block outright.
        const chipX = target.closest(`.${CHIP_X_CLASS}`)
        if (chipX) {
          const xHost = chipX.closest(`[data-composer-chip="${SOURCE}"]`)
          const xSid = xHost && sessionFor(xHost)
          const label = xHost ? chipLabelText(xHost) : ''
          const block = xSid && label ? controller.blockForLabel(xSid, label) : null
          if (block) {
            ev.preventDefault()
            ev.stopPropagation()
            controller.remove(xSid, block.id)
          }
          return
        }
        // Clicking a chip body toggles its detail card.
        const host = target.closest(`[data-composer-chip="${SOURCE}"]`)
        if (host) {
          const label = chipLabelText(host)
          const sid = sessionFor(target)
          if (!sid || !label) return
          const block = controller.blockForLabel(sid, label)
          if (!block) return
          ev.preventDefault()
          ev.stopPropagation()
          controller.select(sid, block.id)
          return
        }
        // Clicking anywhere OUTSIDE the open detail card closes it.
        const withinDetail = target.closest('.dsh-pcb-detail')
        if (withinDetail) return
        for (const [k, ref] of controller.selected) {
          controller.selected.delete(k)
          controller.publish(k)
        }
      }
      ctx.effect(() => {
        document.addEventListener('pointerdown', onChipPointer, true)
        return () => document.removeEventListener('pointerdown', onChipPointer, true)
      }, 'paste-code-block: chip pointer')

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: DETAIL_NS,
        order: 90,
        label: t('slot.label'),
        // Declaring the locale namespace gives the dock a fresh `t` seat prop
        // and re-renders it automatically on every Settings → Language switch.
        locale: NS,
      }, (props) => React.createElement(BlockDock, { ...props, controller, syncChips: scheduleScan })))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
