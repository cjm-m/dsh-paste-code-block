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

    // ===== Locale (embedded copy of src/i18n.js — keep the two in sync) =====
    const NS = 'paste-code-block'
    const L10N = {
      zh: {
        'block.code': '复制代码块{n}',
        'block.text': '复制文本块{n}',
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
      },
      en: {
        'block.code': 'Code block #{n}',
        'block.text': 'Text block #{n}',
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

    function detectBrowserLocale() {
      try {
        const langs = [...(navigator.languages || []), navigator.language].filter(Boolean).map((l) => String(l).toLowerCase())
        return langs.some((l) => l.startsWith('zh')) ? 'zh' : 'en'
      } catch (e) {
        return 'en'
      }
    }

    /**
     * Recognize a rendered block label in ANY shipped locale and recover its
     * `{ type, n }` identity — this keeps chip clicks, ✕ deletes, and the
     * locale-switch retitling correct even for chips inserted under a
     * different language than the one currently active. Null otherwise.
     */
    function parseBlockLabel(text) {
      if (!text) return null
      for (const dict of [L10N.zh, L10N.en]) {
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
     * (i18n key `block.code` vs `block.text`, e.g. "复制代码块N" / "Code block
     * #N") and the fenced language on send.
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
        return actx.bail(actx, 'slash/input-insert-reference', {
          reference: {
            source: SOURCE,
            ref: block.id,
            label: block.label,
            clipboardText: '\u200B',
          },
          span: { start: end, end, draftRev: input.draftRev },
        }) === true
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

      /**
       * Surgically remove the chip node(s) for one ref from the composer editor.
       *
       * NEVER splice the draft via `setDraft()` to delete a chip: setDraft
       * clears the root and re-creates plain-text paragraphs, and chips are
       * Lexical decorator nodes that cannot round-trip through text — so one
       * "spliced out" chip meant EVERY block vanished (0.1.1 bug). Instead we
       * locate the ReferenceChipNode(s) by their public getSource()/getReference()
       * accessors and call the node's own remove() inside one discrete update.
       *
       * @param shell - the session's input shell (exposes `.editor`).
       * @param ref - the block id to remove.
       * @returns true if the editor processed the removal (including "chip was
       *   already gone" — bookkeeping may proceed); false when the editor was
       *   unreachable/errored and the caller must NOT prune its state.
       */
      removeChipNodes(shell, ref) {
        const editor = shell && shell.editor
        if (!editor || typeof editor.update !== 'function') return false
        try {
          editor.update(() => {
            const map = editor.getEditorState() && editor.getEditorState()._nodeMap
            if (!map || typeof map.values !== 'function') return
            const hits = []
            for (const entry of map.values()) {
              const node = entry && entry.node
              if (node && typeof node.getSource === 'function' && typeof node.getReference === 'function'
                && node.getSource() === SOURCE && node.getReference() === ref) hits.push(node)
            }
            for (const node of hits) node.remove()
          }, { discrete: true })
          return true
        } catch (err) {
          console.warn('[paste-code-block] chip node removal failed:', err)
          return false
        }
      }

      remove(sessionId, ref) {
        const k = String(sessionId)
        const entries = this.listFor(k)
        const entry = entries.find((b) => b.id === ref)
        if (!entry) return
        const { shell } = this.scope(sessionId)
        // If the editor itself removed the chip, the synchronous update may
        // have already reconciled this block away — re-check before proceeding.
        if (!this.removeChipNodes(shell, ref)) return
        const stillListed = this.listFor(k)
        if (!stillListed.includes(entry)) return
        if (this.selected.get(k) === ref) this.selected.delete(k)
        const next = stillListed.filter((b) => b.id !== ref)
        if (next.length > 0) this.list.set(k, next)
        else this.list.delete(k)
        this.refIndex.delete(ref)
        for (const [label, r] of this.labelIndex) if (r === ref) this.labelIndex.delete(label)
        this.freeLabel(sessionId, entry.type, entry.labelNumber)
        this.publish(sessionId)
      }

      /** Update a block's content while editing it in the detail card. */
      updateContent(sessionId, ref, content) {
        const record = this.refIndex.get(ref)
        if (!record) return
        record.block.content = content
        record.block.lines = content.split(/\r?\n/)
      }

      clearInFlight(sessionId) {
        const k = String(sessionId)
        const expiry = this.expiry.get(k)
        if (expiry) { clearTimeout(expiry); this.expiry.delete(k) }
        for (const b of this.inFlight.get(k) || []) {
          this.refIndex.delete(b.id)
          this.freeLabel(sessionId, b.type, b.labelNumber)
          for (const [label, r] of this.labelIndex) if (r === b.id) this.labelIndex.delete(label)
        }
        this.inFlight.delete(k)
      }

      markSerializing(ref) {
        const record = this.refIndex.get(ref)
        if (record && !this.serializing.has(record.sessionId)) this.serializing.add(record.sessionId)
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
      }

      dispose() {
        for (const t of this.expiry.values()) clearTimeout(t)
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

      @media (max-width:640px){
        .dsh-pcb-head{height:34px}
        .dsh-pcb-lang{max-width:55%}
      }
      @media (pointer:coarse){
        .${CHIP_X_CLASS}{width:22px;height:22px;font-size:15px}
      }
    `

    // ===== Client plugin body ===============================================
    const inject = ['slots', 'sessions', 'conversation', 'inputTriggers', 'locale']

    function apply(ctx) {
      try { console.log('[dsh-paste-code-block] client loaded') } catch (e) { /* noop */ }

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
      ctx.effect(() => () => controller.dispose(), 'paste-code-block: state')

      // ----- chip DOM sync: localized labels + per-chip ✕ delete button -----
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

      let scanScheduled = 0
      function scheduleScan() {
        if (scanScheduled) return
        const run = () => { scanScheduled = 0; scanChips() }
        scanScheduled = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16)
      }

      ctx.effect(() => {
        if (typeof MutationObserver === 'undefined' || !document.body) return undefined
        const mo = new MutationObserver(scheduleScan)
        mo.observe(document.body, { childList: true, subtree: true })
        return () => mo.disconnect()
      }, 'paste-code-block: chip sync observer')

      // A locale switch (or a late dictionary registration bumps the revision
      // too) re-derives labels: controller state first, chip DOM second.
      ctx.effect(() => {
        const face = ctx.locale
        if (!face || typeof face.subscribe !== 'function') return undefined
        return face.subscribe(() => { controller.retitleAll(); scheduleScan() })
      }, 'paste-code-block: locale sync')
      scheduleScan() // late-mount safety for chips rendered before plugin boot

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

      // Resolve the active session for an event inside the composer seat.
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
