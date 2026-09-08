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
relative ESM files — `client.js` **cannot** `import` a sibling module. Its parsing logic is
therefore **embedded** in the bundle. To keep that logic unit-testable, the same functions are
extracted into `src/parse.js` (a plain, dependency-free ESM module) which the test suite
exercises. **Keep `src/parse.js` and the embedded copy in `src/client.js` in sync.**

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

The chip label is the human-readable badge (`复制代码块N` / `复制文本块N`); clicking it opens the
detail card.

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

`tests/parse.test.js` exercises the pure parsing module (`src/parse.js`) with the built-in
`node:test` runner (no test framework dependency). The DOM/controller glue is not unit-tested
because it depends on the live DSH client runtime; it is verified manually in the browser.

```sh
npm test
```