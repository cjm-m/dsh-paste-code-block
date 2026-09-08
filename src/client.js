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

    // ===== Block parsing =====================================================
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
     * that should paste plainly. `isCode` drives both the chip wording
     * ("复制代码块N" vs "复制文本块N") and the fenced language on send.
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
      constructor(ctx) {
        this.ctx = ctx
        this.list = new Map()      // sessionId -> Block[]
        this.selected = new Map()  // sessionId -> ref
        this.used = new Map()      // sessionId -> {code:Set, text:Set}
        this.refIndex = new Map()  // ref -> {sessionId, block}
        this.labelIndex = new Map()// label -> ref
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

      labelFor(block, n) {
        return block.isCode ? `复制代码块${n}` : `复制文本块${n}`
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

      blockForLabel(label) {
        const ref = this.labelIndex.get(label)
        return ref ? this.refIndex.get(ref)?.block : undefined
      }

      select(sessionId, ref) {
        const k = String(sessionId)
        const cur = this.selected.get(k)
        if (cur === ref) this.selected.delete(k)
        else this.selected.set(k, ref)
        this.publish(sessionId)
      }

      remove(sessionId, ref) {
        const k = String(sessionId)
        const entries = this.listFor(k)
        const entry = entries.find((b) => b.id === ref)
        if (!entry) return
        if (this.selected.get(k) === ref) this.selected.delete(k)
        const { shell } = this.scope(sessionId)
        const input = shell.snapshot
        const occurrence = (input.occurrences || []).find((o) => o.source === SOURCE && o.ref === ref)
        if (occurrence) {
          shell.setDraft(input.draft.slice(0, occurrence.offset) + input.draft.slice(occurrence.offset + 1))
        }
        const next = entries.filter((b) => b.id !== ref)
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
        if (!record) throw new Error('代码块已失效，请重新粘贴')
        this.markSerializing(ref)
        return serializeBlock(record.block)
      }

      /**
       * Keep only blocks whose inline chip is still present in the draft (the
       * user may delete a chip with Backspace). During a submit the chips may
       * transiently vanish, so prune is deferred there.
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

      useComposerMark(railRef, props.sessionId, input.draftRev, blocks.length > 0)

      React.useEffect(() => {
        props.controller.reconcile(props.sessionId, input.occurrences || [], input.phase)
      }, [props.controller, props.sessionId, input.draftRev, input.phase])

      React.useEffect(() => {
        if (promptError && props.controller.inFlight.has(String(props.sessionId))) {
          props.controller.restoreFailed(props.sessionId)
        }
      }, [props.controller, props.sessionId, promptError])

      const empty = !selected
      return React.createElement(
        'div',
        {
          ref: railRef,
          className: `dsh-pcb-dock${empty ? ' dsh-pcb-dock--empty' : ''}`,
          'data-dsh-pcb-rail': '',
          'data-dsh-pcb-session': String(props.sessionId),
          'aria-label': '代码块详情',
        },
        selected
          ? React.createElement(BlockDetail, {
              block: selected,
              controller: props.controller,
              sessionId: props.sessionId,
            })
          : null,
      )
    }

    function BlockDetail(props) {
      const { block, controller, sessionId } = props
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

      return React.createElement(
        'div',
        { className: `dsh-pcb-detail${collapsed ? ' dsh-pcb-detail--collapsed' : ''}` },
        React.createElement(
          'div',
          { className: 'dsh-pcb-head' },
          React.createElement('span', { className: 'dsh-pcb-lang' }, block.lang || 'text'),
          React.createElement('span', { className: 'dsh-pcb-lines' }, `${block.lines.length} 行`),
          React.createElement('span', { className: 'dsh-pcb-spacer' }),
          collapsed ? React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: '展开', 'aria-label': '展开',
            onClick: () => setCollapsed(false),
          }, '▾') : React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: '折叠', 'aria-label': '折叠',
            onClick: () => setCollapsed(true),
          }, '▸'),
          React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: '复制', 'aria-label': '复制',
            onClick: copy,
          }, copied ? '✓' : '⎘'),
          React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn', title: '收起', 'aria-label': '收起',
            onClick: hide,
          }, '⟨'),
          React.createElement('button', {
            type: 'button', className: 'dsh-pcb-btn dsh-pcb-btn--danger', title: '移除', 'aria-label': '移除',
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
              'aria-label': '编辑代码块内容',
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
      /* the label text */
      [data-composer-chip="${SOURCE}"] > span > span:last-child{font-weight:500!important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

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
    `

    // ===== Client plugin body ===============================================
    const inject = ['slots', 'sessions', 'conversation', 'inputTriggers']

    function apply(ctx) {
      try { console.log('[dsh-paste-code-block] client loaded') } catch (e) { /* noop */ }
      const controller = new BlockController(ctx)
      ctx.effect(() => () => controller.dispose(), 'paste-code-block: state')

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

      // Clicking an inline chip toggles its detail card.
      const onChipPointer = (ev) => {
        const target = ev.target
        if (!(target instanceof Element)) return
        // Clicking a chip toggles its detail card.
        const host = target.closest(`[data-composer-chip="${SOURCE}"]`)
        if (host) {
          const labelEl = host.querySelector(':scope > span[title]') || host.querySelector('span[title]')
          const label = labelEl && labelEl.getAttribute('title')
          const sid = sessionFor(target)
          if (!sid || !label) return
          const block = controller.blockForLabel(label)
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
        label: '粘贴代码块详情',
      }, (props) => React.createElement(BlockDock, { ...props, controller })))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
