/**
 * Fold smoke test — runs the REAL embedded client.js logic (module factory,
 * scanFolds, card building, toggling, locale retitle, orphan sweep, dispose)
 * against a minimal DOM shim. No browser, no dependencies.
 *
 * The shim implements exactly the subset client.js touches:
 * attrs, children, textContent, classList, style, closest (single compound),
 * querySelectorAll ([attr], [attr="v"], [class*="v"], .class, tag; comma +
 * descendant pairs), insertAdjacentElement('afterend'), event listeners.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ---------------- mini DOM ----------------
class TextNode {
  constructor(t) { this.nodeType = 3; this._t = t; this.parentElement = null }
  get textContent() { return this._t }
  set textContent(v) { this._t = String(v) }
}
class El {
  constructor(tag, doc) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.attrs = new Map()
    this.childNodes = []
    // Faithful style: unset properties read back as '' like CSSStyleDeclaration.
    this.style = new Proxy({}, {
      get: (o, k) => (k in o ? o[k] : ''),
      set: (o, k, v) => { o[k] = v; return true },
    })
    this._listeners = {}
    this.parentElement = null
    this._doc = doc
  }
  get className() { return this.attrs.get('class') || '' }
  set className(v) { this.attrs.set('class', v) }
  get dataset() { return (this._dataset ||= {}) }
  get type() { return this.attrs.get('type') || '' }
  set type(v) { this.attrs.set('type', v) }
  get classList() {
    const self = this
    return { contains: (c) => ` ${self.className} `.split(' ').filter(Boolean).includes(c) }
  }
  get isConnected() { let e = this; while (e.parentElement) e = e.parentElement; return e === this._doc.body }
  setAttribute(k, v) { this.attrs.set(k, String(v)) }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
  removeAttribute(k) { this.attrs.delete(k) }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1) }
  get textContent() { return this.childNodes.map((n) => n.textContent).join('') }
  set textContent(v) { this._clear(); if (v !== '') this._appendNode(new TextNode(String(v))) }
  get nextElementSibling() {
    const sibs = this.parentElement ? this.parentElement.children : []
    return sibs[sibs.indexOf(this) + 1] || null
  }
  get previousElementSibling() {
    const sibs = this.parentElement ? this.parentElement.children : []
    return sibs[sibs.indexOf(this) - 1] || null
  }
  appendChild(n) { this._appendNode(n); return n }
  append(...ns) { for (const n of ns) this._appendNode(n) }
  insertAdjacentElement(pos, el) {
    if (pos !== 'afterend') throw new Error('shim: only afterend needed')
    const p = this.parentElement
    if (!p) throw new Error('shim: no parent')
    el.parentElement?._detach(el)
    p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, el)
    el.parentElement = p
  }
  remove() { this.parentElement?._detach(this) }
  _detach(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentElement = null }
  _appendNode(n) { if (n.nodeType === 1 && n.parentElement) n.parentElement._detach(n); n.parentElement = this; this.childNodes.push(n) }
  _clear() { for (const c of this.childNodes) c.parentElement = null; this.childNodes.length = 0 }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn) }
  dispatch(type) { for (const fn of this._listeners[type] || []) fn({ preventDefault() {}, stopPropagation() {}, target: this }) }
  querySelectorAll(sel) { return queryAll(this._doc, sel, this) }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
  closest(sel) {
    let e = this
    while (e) { if (matchSingle(e, sel.trim())) return e; e = e.parentElement }
    return null
  }
  matches(sel) { return matchSingle(this, sel.trim()) }
}
function walk(root, fn) {
  for (const c of root.childNodes) if (c.nodeType === 1) { fn(c); walk(c, fn) }
}
function parseCompound(comp) {
  const out = { tag: null, classes: [], attrs: [] }
  for (const m of comp.matchAll(/(^[A-Za-z][\w-]*)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)"([^"]*)")?\]/g)) {
    if (m[1]) out.tag = m[1].toUpperCase()
    else if (m[2]) out.classes.push(m[2])
    else out.attrs.push({ name: m[3], op: m[4] || null, value: m[5] ?? null })
  }
  return out
}
function matchCompound(el, comp) {
  const c = parseCompound(comp)
  if (c.tag && el.tagName !== c.tag) return false
  const cls = ` ${el.className} `
  for (const k of c.classes) if (!cls.includes(` ${k} `)) return false
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name)
    if (v === null) return false
    if (a.op === '=*' || a.op === '*=') { if (!v.includes(a.value)) return false }
    else if (a.op === '^=') { if (!v.startsWith(a.value)) return false }
    else if (a.op === '$=') { if (!v.endsWith(a.value)) return false }
    else if (a.op === '=') { if (v !== a.value) return false }
  }
  return true
}
function matchSingle(el, sel) { return sel.split(',').some((part) => matchChain(el, part)) }
function matchChain(el, part) {
  const comps = part.trim().split(/\s+(?![^[]*\])/)
  if (!matchCompound(el, comps[comps.length - 1])) return false
  let node = el.parentElement
  for (let i = comps.length - 2; i >= 0; i -= 1) {
    let found = false
    while (node) { if (matchCompound(node, comps[i])) { found = true; node = node.parentElement; break } node = node.parentElement }
    if (!found) return false
  }
  return true
}
function queryAll(doc, sel, root) {
  const out = []
  walk(root || doc.body, (el) => { if (sel.split(',').some((p) => matchChain(el, p)) && !out.includes(el)) out.push(el) })
  return out
}

const doc = { body: null, head: null }
doc.body = new El('body', doc)
doc.head = new El('head', doc)
globalThis.document = {
  body: doc.body,
  head: doc.head,
  createElement: (tag) => new El(tag, doc),
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll: (sel) => queryAll(doc, sel),
}
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } }, configurable: true,
})
globalThis.MutationObserver = class { constructor(cb) { this.cb = cb } observe() {} disconnect() {} }
globalThis.requestAnimationFrame = (fn) => fn()
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      const fakeRequire = (id) => (id === 'react' ? {
        useState: () => [0, () => {}], useEffect() {}, useLayoutEffect() {}, useRef: () => ({ current: null }),
        createElement: () => null, Fragment: {}, memo: (x) => x,
      } : (() => { throw new Error('unexpected require ' + id) })())
      const loaded = def.factory(fakeRequire)
      globalThis.__pcb = loaded
    },
  },
}

// ---------------- load the real client bundle ----------------
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'src', 'client.js'), 'utf8')
new Function('window', 'document', 'navigator', 'MutationObserver', 'requestAnimationFrame', src)(
  globalThis.window, globalThis.document, globalThis.navigator, globalThis.MutationObserver, globalThis.requestAnimationFrame,
)
assert.ok(globalThis.__pcb && typeof globalThis.__pcb.apply === 'function', 'client.js registered with the module loader')

// ---------------- boot apply() with a fake ctx ----------------
let locale = 'zh'
const DICT = {
  zh: { 'fold.code': '代码块', 'fold.text': '文本块', 'fold.aria': '展开或折叠该块', 'lines.one': '{count} 行', 'lines.other': '{count} 行', expand: '展开', collapse: '折叠', copy: '复制' },
  en: { 'fold.code': 'Code', 'fold.text': 'Text', 'fold.aria': 'Expand or collapse this block', 'lines.one': '{count} line', 'lines.other': '{count} lines', expand: 'Expand', collapse: 'Collapse', copy: 'Copy' },
}
const subs = []
const cleanups = []
const ctx = {
  locale: {
    register() {},
    bind: () => (key, params) => {
      const dict = DICT[locale] || DICT.en
      let text = dict[key] != null ? dict[key] : (DICT.en[key] != null ? DICT.en[key] : key)
      if (params) text = text.replace(/\{(\w+)\}/g, (m2, name) => (name in params ? String(params[name]) : m2))
      return text
    },
    subscribe: (cb) => { subs.push(cb); return () => {} },
  },
  effect: (fn) => { const c = fn(); if (typeof c === 'function') cleanups.push(c) },
  slots: { inject() {}, register() {} },
  inputTriggers: { registerSource() {} },
  sessions: {},
  conversation: {},
}
globalThis.__pcb.apply(ctx)

// ---------------- fixture ----------------
function flowRow(kind, key, runs) {
  const row = new El('div', doc)
  row.setAttribute('data-chat-flow-kind', kind)
  row.setAttribute('data-chat-flow-key', key)
  const stack = new El('div', doc)
  const bubble = new El('div', doc)
  bubble.className = '_bubble_1x2y3_9'
  stack.appendChild(bubble)
  row.appendChild(stack)
  doc.body.appendChild(row)
  for (const text of runs) {
    const span = new El('span', doc)
    span.className = '_plainRun_z12h9_6'
    span.textContent = text
    bubble.appendChild(span)
  }
  return bubble
}

const fenced = '帮我看看这段代码\n```python\na = 1\nprint(a)\n```\n然后是文本\n```text\nlong pasted paragraph line\nsecond line\n```'
const b1 = flowRow('user', 'node-1', [fenced])
const b2 = flowRow('user', 'node-2', ['short note, no fences here'])
const b3 = flowRow('steering', 'node-3', ['```json\n{"x": 1}\n```'])

// apply()'s late-mount scan ran against an empty body; kick one now that the
// fixtures exist (the shim's MutationObserver is inert, so drive it directly).
function scanAgain() { subs[0]() } // locale subscribe bumps foldRev + schedules the scan
scanAgain()

// 1. fenced runs folded: run hidden, host present, 2 cards with zh titles
test('sent fences fold into cards; prose run is hidden not removed', () => {
  const run = b1.children[0]
  assert.equal(run.style.display, 'none')
  assert.ok((run.getAttribute('data-dsh-pcb-run') || '').startsWith('1|'))
  const host = b1.children[1]
  assert.ok(host.classList.contains('dsh-pcb-fold-host'))
  const cards = host.children.filter((c) => c.classList.contains('dsh-pcb-fold'))
  assert.equal(cards.length, 2)
  assert.equal(cards[0].getAttribute('data-pcb-type'), 'code')
  assert.equal(cards[0].children[0].querySelector('.dsh-pcb-fold-title').textContent, 'python · 2 行')
  assert.equal(cards[0].getAttribute('data-open'), '0', 'collapsed by default')
  assert.equal(cards[1].getAttribute('data-pcb-type'), 'text')
  assert.equal(cards[1].children[0].querySelector('.dsh-pcb-fold-title').textContent, '文本块 · 2 行')
  const pre = cards[0].children[1]
  assert.equal(pre.className, 'dsh-pcb-fold-body')
  assert.equal(pre.textContent, 'a = 1\nprint(a)')
  // prose segments around the fences stay visible
  const prose = host.children.filter((c) => c.classList.contains('dsh-pcb-fold-prose'))
  assert.equal(prose.length, 2)
  assert.equal(prose[0].textContent, '帮我看看这段代码')
  assert.equal(prose[1].textContent, '然后是文本')
})

test('non-fenced messages are left alone (checked marker, still visible)', () => {
  const run = b2.children[0]
  assert.equal(run.style.display, '')
  assert.ok((run.getAttribute('data-dsh-pcb-run') || '').startsWith('0|'))
  assert.equal(b2.children.filter((c) => c.classList.contains('dsh-pcb-fold-host')).length, 0)
})

test('steering bubbles fold too', () => {
  const host = b3.children[1]
  assert.ok(host && host.classList.contains('dsh-pcb-fold-host'))
  assert.equal(host.querySelector('.dsh-pcb-fold-title').textContent, 'json · 1 行')
})

// 2. idempotence + open-state persistence + locale retitle
test('rescan keeps exactly one host, preserves expand state, retitles on locale switch', () => {
  const toggle = b1.children[1].querySelector('.dsh-pcb-fold-toggle')
  toggle.dispatch('click')
  const card = b1.children[1].children.filter((c) => c.classList.contains('dsh-pcb-fold'))[0]
  assert.equal(card.getAttribute('data-open'), '1')

  scanAgain() // foldRev bump -> stamps stale -> full rebuild (same language)
  assert.equal(b1.children.filter((c) => c.classList.contains('dsh-pcb-fold-host')).length, 1, 'no duplicate hosts')
  const card2 = b1.children[1].children.filter((c) => c.classList.contains('dsh-pcb-fold'))[0]
  assert.equal(card2.getAttribute('data-open'), '1', 'user-opened card survives the rebuild')

  locale = 'en'
  scanAgain()
  const card3 = b1.children[1].children.filter((c) => c.classList.contains('dsh-pcb-fold'))[0]
  assert.equal(card3.children[0].querySelector('.dsh-pcb-fold-title').textContent, 'python · 2 lines')
  assert.equal(b1.children[1].children.filter((c) => c.classList.contains('dsh-pcb-fold'))[1].children[0].querySelector('.dsh-pcb-fold-title').textContent, 'Text · 2 lines')
  locale = 'zh'
  scanAgain()
})

// 3. content edits re-fold
test('a run whose text changes re-folds (or unfolds when fences vanish)', () => {
  const run = b2.children[0]
  run.textContent = '带围栏\n```\nbody line\n```\n'
  scanAgain()
  assert.equal(run.style.display, 'none')
  assert.equal(b2.children.filter((c) => c.classList.contains('dsh-pcb-fold-host')).length, 1)
  run.textContent = 'now plain again'
  scanAgain()
  assert.equal(run.style.display, '')
  assert.equal(b2.children.filter((c) => c.classList.contains('dsh-pcb-fold-host')).length, 0, 'fold undone when no fences remain')
})

// 4. orphan host sweep after a React remount
test('stale hosts are swept when React replaces the run underneath them', () => {
  const run = b3.children[0]
  const staleHost = b3.children[1]
  run.remove()
  const fresh = new El('span', doc)
  fresh.className = '_plainRun_z12h9_6'
  fresh.textContent = '```json\n{"x": 1}\n```'
  b3.childNodes.unshift(fresh)
  fresh.parentElement = b3
  scanAgain()
  const hosts = b3.children.filter((c) => c.classList.contains('dsh-pcb-fold-host'))
  assert.equal(hosts.length, 1, 'exactly one host after the sweep')
  assert.notEqual(hosts[0], staleHost, 'the stale host was removed, the new one survived')
  assert.equal(fresh.style.display, 'none')
})

// 5. dispose hands the transcript back
test('dispose removes every fold host and unhides every run', () => {
  for (const c of cleanups) c()
  assert.equal(document.querySelectorAll('.dsh-pcb-fold-host').length, 0)
  const runs = document.querySelectorAll('[data-dsh-pcb-run]')
  assert.equal(runs.length, 0)
  for (const b of [b1, b3]) {
    assert.equal(b.children.filter((c) => c.classList.contains('dsh-pcb-fold-host')).length, 0)
  }
})
