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

The chip label is the localized human-readable badge (`代码块 N` / `Code #N` — see §9);
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

So `代码块 1` … `代码块 N` and `文本块 1` … `文本块 M` each count independently and
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

**Naming and visual identity (0.1.3).** A chip is a *reference badge*, not an action button, so
the pre-0.1.3 names carried a verb nobody invokes on it — `复制代码块N` / `Code block #N` read
like a command and burned width inside the composer. Current names are noun + number
(`代码块 1` / `Code #1`). The code/text distinction moved from wording to visuals: `scanChips`
tags every chip host with `data-pcb-type`, and CSS renders a leading glyph — `</>` for code
(mono, business-primary) and `Aa` for text (neutral gray) — plus a soft blue tint on code
chips. Pre-0.1.3 labels stay parseable through the `legacyLabels` table, so chips inserted by
an older bundle keep their click/✕/retitle identity until the next locale-synced retitle.

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
block destroyed *every* chip in the draft. `removeChipNodes()` instead scans the editor's node
map for `ReferenceChipNode`s whose public `getSource()`/`getReference()` match this plugin and
the block's ref, and calls the node's own `remove()` inside one discrete update — a surgical,
undoable (`Ctrl+Z`) deletion that leaves sibling chips untouched.

**The 0.1.2 silent no-op.** The node map (`editor.getEditorState()._nodeMap`) is keyed by
NodeKey and **its values are the nodes themselves**; the older `NodeState` wrapper with a
`.node` field no longer exists. Reading `value.node` therefore matched *nothing* for every
entry, `removeChipNodes()` removed zero chips, yet the call looked successful — the block's
state was pruned behind a chip that was still in the draft, so clicking ✕ appeared to do
nothing at all. `src/chip-nodes.js` now normalizes both shapes (`chipNodeOf`) and is unit
tested for exactly this rule; `tests/lexical-chip-probe.mjs` reproduces the original defect
against real `lexical@0.49.0`:

```
_nodeMap value shape:      valueIsNode=true, hasNodeProp=false
OLD code (value.node):     removed = 0 | chips after = r1,r2,r3   <- silent no-op
NEW code (value is node):  removed = 1 | chips after = r1,r3      <- only the target
```

**Failure is never silent and never destructive.** `remove()` gates every state change on
`chipPresent()` — the editor's node map first, the published occurrence projection as a
cross-check — so a block is pruned only once its chip is verifiably gone. If the chip survives
the attempt the block stays tracked and the composer surfaces `error.remove`; the old
`setDraft` fallback is gone for good. State that diverges from the editor still self-heals via
`reconcile`.

## 11. Insertion leaves no stray space

`SessionInputShell.insertReference` inserts `[chip, ' ']` — a separating space — whenever the
character at the pick-time span is not itself a space. Because a block is always appended at
the **end** of the draft, that condition is always true, so every paste used to leave a space
behind: text typed next started with a space (the visible "prefix space"), and pasting several
blocks piled stray spaces into the message body.

Two rules keep the draft clean without ever touching user whitespace:

1. **Insert, then drop exactly the appended character.** `dropSeparatorSpace()` asks
   `separatorSpaceSpan()` (src/projection.js) for the detect span of the character directly
   after *our* chip and deletes it with the same public `slash/input-insert-text` verb DSH uses
   for its own span edits. Since the chip is inserted at the end, that character can only have
   come from the insertion itself — a trailing space the user had already typed still sits
   before the chip, untouched. The span is only used when the projection shows a space right
   after this block's chip, and a failure to apply just logs (the draft keeps DSH's behaviour).
2. **Delete removes the chip node only.** `remove()` drops the chip's Lexical node
   (§10) and never rewrites text, so spaces around a deleted block survive exactly as they were.

`src/projection.js` owns the coordinate conversion this needs: the published `draft` is the
clipboard projection (a chip occupies `occurrence.length` characters, i.e. one zero-width space
for us) while the scoped edit verbs address detect coordinates (a chip collapses to exactly one
placeholder character). `detectOffsetOf()` converts with
`detect = clipboard - Σ(len_i - 1)` over preceding occurrences, so blocks stay correctly
addressed even when other plugins' chips (file references and the like) sit in the same draft.
Both helpers are pure and unit-tested (8 cases in tests/projection.test.js).

## 12. Sent-message folding (0.2.0)

The composer fold was only half the story: on send the chips expand back into fenced text, and
DSH renders user bubbles as **plain pre-wrap text** (`projectUserText` → `span.plainRun` runs
plus `data-ref-chip` badges), so the sent message reappeared in the transcript as the very wall
of text the plugin exists to prevent. §12 folds *sent* blocks back down.

**Where the DOM hooks are.** Every conversation row carries `data-chat-flow-kind`
(`user` / `steering` / `agent` / …) and `data-chat-flow-key` on its wrapper; the right-aligned
user bubble lives under the same row and contains the `plainRun` spans. The send echo
(`data-submission-echo`) and pending steering (`data-pending-steering`) render the same bubble
markup one frame before the durable node exists, so scanning all four gives an instant
collapsed view from the moment of send. Assistant output is deliberately not touched: its
markdown renderer already styles code blocks its own way.

**Never fight React.** The bubble's children belong to React; removing them would make the
next reconciliation throw. So the fold *hides* a qualifying `plainRun` span (`display:none` —
the node stays a child, React keeps patching it harmlessly) and inserts a
`div.dsh-pcb-fold-host` **after** it. The host is ours: prose segments re-render as
`span.dsh-pcb-fold-prose`, each fence as a collapsed card (glyph `</>`/`Aa` + localized title
`python · 128 行` / `Text · 128 lines`, copy button copying the **raw fenced text** exactly as
sent, click-to-expand `<pre>`). Since hiding a child does not affect `textContent`, the
message action bar (React-side copy/edit/delete) is entirely unaffected.

**What folds.** `splitFencedSegments()` (canonical in `src/parse.js`, embedded copy in
`client.js`) walks the run line by line with GFM fence rules (``` or ~~~, opener indented ≤ 3
spaces, closer ≥ opener length alone on its line; backticks in a ``` info string kill that
opener; an unterminated opener stays prose). Any fence segment with a non-empty body folds;
everything else — prose, whitespace between blocks, empty fences — renders verbatim around
the cards. Fence-only (not "any long text") is deliberate: composer-created blocks always
travel as fences, while unfenced long messages may have been *typed*, and silently folding
typed prose would be a nasty surprise.

**Idempotence and refresh.** Each scanned run gets
`data-dsh-pcb-run = "1|<stamp>"` (folded) or `"0|<stamp>"` (checked, nothing to fold), where
the stamp folds `foldRev`, text length, and an FNV-1a hash. The shared chip-sync
MutationObserver coalesces to one rAF scan; a run whose stamp matches is skipped, so steady
state costs attribute reads. A locale switch bumps `foldRev`, which invalidates every stamp —
the next scan rebuilds each host and re-titles cards from the live translator. Rebuilds
preserve who was expanded via a stable `flowKey#runIndex:segIndex` open set, and an orphan
sweep drops any host whose predecessor is no longer its hidden, stamp-matching run (React can
remount the run underneath us). Disposal (HMR / plugin removal) removes all hosts and unhides
every run — the transcript hands back clean.

`tests/fold-smoke.test.js` exercises the real bundle against a dependency-free DOM shim:
fold → marker/card/prose structure, steering rows, non-fenced messages untouched, retitle
across locale switches with open-state kept, text edits re-fold and unfold, orphan sweep,
and dispose restoration.