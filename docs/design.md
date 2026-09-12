# Design notes — dsh-paste-code-block

This document captures the non-obvious design decisions behind the plugin, so future
contributors understand *why* the code is the way it is. It is not a usage guide — see
[README.md](../README.md) for that.

## 1. One plugin, two halves

A DSH plugin can ship a **host** (node) half and a **client** (browser) half. This plugin is a
*pure UI* plugin: all behavior lives on the browser side.

- `src/index.js` — host half. **Intentionally empty.** It exists only so the package resolves
  as a DSH plugin and so the `dsh.client` declaration in `package.json` is discovered.
- `src/client.js` — browser half. A self-contained UMD bundle loaded via
  `window.__ModuleLoader__.load({ id, factory })`. It captures pastes, restyles DSH's inline
  reference chips into boxed badges, and renders an editing detail card above the composer.

Because the client is loaded by DSH's module loader — which resolves *package names*, not
relative ESM files — `client.js` **cannot** `import` a sibling module. Its runtime logic is
therefore **embedded** in the bundle. To keep that logic unit-testable, the same functions are
extracted into plain, dependency-free ESM modules which the test suite exercises:

- `src/parse.js` — block detection / language detection / serialization.
- `src/i18n.js` — locale dictionaries, label building, and label parsing.

**Keep `src/parse.js` / `src/i18n.js` and their embedded copies in `src/client.js` in sync.**

## 2. How a paste becomes a card (the pipeline)

```
paste event
  └─ parseBlock(text)            → Block | null      (pure logic, in src/parse.js)
       └─ is short plain prose?  → null → paste as-is (don't intercept)
       └─ else                   → { lang, content, lines, isCode }
  └─ controller.attach(sid, block)
       ├─ nextLabel(sid, type)   → smallest free number (code/text counted apart)
       ├─ insertReference(...)   → DSH 'slash/input-insert-reference' with clipboardText '\u200B'
       └─ publish(sid)           → re-render the dock
```

## 3. The hidden-reference codec

The card is rendered by DSH's existing **hidden-reference (chip)** machinery — the same
mechanism that renders file/upload references inline. The plugin registers a source under the
`@` input trigger:

- `trigger: '@'`, `name: 'paste-code-block'`
- `codec.clipboardText` → `''` (the chip leaves no visible text on copy)
- `codec.serialize(ref)` → the block's fenced ```` ```lang … ``` ```` text

The chip label is the localized human-readable badge (`复制代码块N` / `Code block #N` — see §9);
clicking it opens the detail card, and each chip carries a `×` button that deletes the block
(see §10).

## 4. Why `clipboardText` is U+200B (zero-width space)

`insertReference` passes `clipboardText: '\u200B'`. This is deliberate:

- Each chip contributes exactly **one character** to the editor's detect text.
- `String.prototype.trim()` does **not** strip U+200B, so the composer's empty check
  (`draft.trim() === ""`) sees a draft with only chips as *non-empty*, keeping the send button
  enabled even when the user pasted a block with no surrounding text.
- Because `draft.length` then equals the detect length, anchoring insertions at `draft.length`
  keeps chips strictly ordered — fixing the earlier "every 3rd block shifts forward by 1" bug.

## 5. Numbering and reuse

Numbers are tracked **per session, split by type** (`code` vs `text`):

- `nextLabel` always allocates the **smallest free integer** (`while (used.has(n)) n++`).
- Deleting a chip frees its number; the next paste reuses it.

So `复制代码块1` … `复制代码块N` and `复制文本块1` … `复制文本块M` each count independently and
stay dense after removals.

## 6. Markdown vs. code detection

The trickiest heuristic is deciding whether pasted text is *code* or *markdown prose*. The
signal counter `countMarkdownSignals` scores structural markdown (headings, blockquotes, lists,
links, bold, tables, hr). A lone `#` comment in code scores 1 and stays code; a real markdown
document scores ≥2 and is treated as text. Fenced snippets always win as code.

## 7. Anchor stability and reconcile

Blocks are **appended at the end of the draft**, reusing DSH's hidden-reference semantics so
cursor/undo stay stable. During a submit the chips may transiently vanish; `reconcile` defers
pruning while `serializing` is setatch, and `restoreFailed` re-surfaces in-flight blocks if the
send fails — so a failed send auto-refills the input.

## 8. Testing strategy

`tests/parse.test.js` and `tests/i18n.test.js` exercise the two pure modules (`src/parse.js`,
`src/i18n.js`) with the built-in `node:test` runner (no test framework dependency). The
DOM/controller glue is not unit-tested because it depends on the live DSH client runtime; it is
verified manually in the browser.

```sh
npm test
```

## 9. Localization (i18n)

Block names are produced through **DSH's own locale service**, the same one first-party plugins
(schedule, session-log-export, …) use:

- `apply()` registers the `paste-code-block` namespace via `ctx.locale.register(NS, {zh, en})`
  with *identical key sets* in both dictionaries (the built-in locale runtime assumes that).
- All user-visible strings — chip labels (`block.code` / `block.text` with `{n}`), button
  tooltips, the `{count}` line counter (with a `lines.one` / `lines.other` plural split),
  aria labels, slot label, and the stale-block send error — go through the bound translator
  `t(key, params)`.
- The dock slot entry declares `locale: NS`, so the renderer hands it a fresh `t` seat **and
  re-renders it on every locale revision**.

**Chip retitling across switches.** The chip label is *insert-time* content: Lexical caches the
label inside the decorator node, and React never re-renders those node bodies while the node
state is unchanged. So on a locale switch the plugin: (1) recomputes `block.label` for every
tracked block and rebuilds `labelIndex` (`retitleAll`), then (2) patches the visible DOM —
`title` attribute and label span `.textContent` — inside `scanChips`. React's virtual DOM
record still says the old label, so it never fights the patch; a full chip remount (the only
revert vector) is caught by the same MutationObserver that manages the ✕ button.

**Cross-language identity.** `parseBlockLabel` recognizes a rendered label in **any** shipped
locale and recovers `{ type, n }`; lookups (chip click, ✕ delete, retitle matching) resolve the
block by that identity within the chip's own session. A chip inserted under one language keeps
working after switching to the other.

## 10. The per-chip ✕ delete button

DSH renders chips from Lexical decorator nodes; third parties cannot add React children to
them. Instead the plugin **appends a `<span class="dsh-pcb-chip-x">×</span>` into each chip's
inner element** and keeps them present with a `MutationObserver` on `document.body`
(rAF-coalesced; the scan exits immediately when no block is tracked). A capture-phase
`pointerdown` handler checks `.dsh-pcb-chip-x` **before** the toggle logic and calls
`controller.remove`, which removes **just that chip's Lexical node** and frees its number. If
the chip is not backed by a tracked block (e.g. a restored draft after redraw), no ✕ is added —
no dead affordances. Touch targets grow on coarse pointers (`@media (pointer:coarse)`).

**Why node-level removal matters — the 0.1.1 incident.** The first `remove()` implementation
spliced the chip's placeholder char out of the draft string and wrote the result through
`shell.setDraft()`. But `setDraft` **clears the editor root and rebuilds plain-text
paragraphs** — chips are decorator nodes that cannot round-trip through text, so deleting one
block destroyed *every* chip in the draft. `removeChipNodes()` instead scans the pending
state's node map for `ReferenceChipNode`s whose public `getSource()`/`getReference()` match
this plugin and the block's ref, and calls the node's own `remove()` inside one discrete
update — a surgical, undoable (`Ctrl+Z`) deletion that leaves sibling chips untouched. If the
editor is unreachable or the update throws, the block is *kept* rather than falling back to
`setDraft`; state that diverges from the editor self-heals via `reconcile` anyway.