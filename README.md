<div align="center">

# dsh-paste-code-block

**Cherry Studio‑style text/code block pasting for DeepSeek Harness Web**

Paste text/code into the DSH Web composer → it collapses into a **bordered, collapsible, language-tagged card** instead of a long flat string; on send it restores the original content as a fenced code block.

`type: module` · `runtime: host` · `client: web` · MIT

**[中文](./README.zh-CN.md) | English**

</div>

---

## Features

- 📋 **Smart detection** — pasted content with ``` fences, newlines, or long indented code becomes a card; ordinary short prose pastes as-is.
- 🏷️ **Language tags** — auto-detects Python / JS / JSON / YAML / SQL / bash / HTML·XML / C++ / Go / Ruby (incl. shebang). Plain text blocks are tagged `text`.
- 📂 **Collapsible card** — collapsed by default showing a one-line preview; click to expand full code (scrollable, up to 260px).
- ✏️ **In‑card editing** — edit the block content right in the detail card; the send path uses your edited text.
- 📤 **Restore on send** — each card is restored to a ```` ```lang … ``` ```` fenced block; a failed send auto-fills it back into the input.
- 🔢 **Smart numbering** — code and text are counted apart; deleting a block frees its number for reuse (smallest-free allocation).
- 📱 **All surfaces** — pure client plugin; works on PC & mobile Web, adapts to light/dark themes.

## Install

Requires DSH `0.1.x` (current developer preview — APIs may change).

Published on **npm** — install directly by name:

```sh
dsh plugin --profile web add dsh-paste-code-block
```

Alternatively, install from this Git repository or a local folder:

```sh
# From GitHub
dsh plugin --profile web add github:cjm-m/dsh-paste-code-block

# From a local checkout
dsh plugin --profile web add file:/path/to/dsh-paste-code-block
```

**Restart `dsh web`** after installing.

## Usage

1. Copy a block of code or a multi-line block of text anywhere.
2. Paste it into the DSH input → it becomes a code-block card.
3. Expand / copy / edit / remove as you like; press Enter or send and it's restored as a fenced code block.

## Notes & boundaries

- Blocks are **appended at the end of the draft** (reusing DSH's hidden-reference semantics), keeping cursor/undo stable; ordinary short text is not intercepted.
- Plain-text blocks are wrapped in ```` ```text ``` ```` on send so they don't smear into one line.
- Detection threshold: **contains newline / ≥2 lines / length ≥96 / indented or fenced** — any one triggers the card.

## Project layout

```
dsh-paste-code-block/
├── src/
│   ├── client.js       # Web (browser) half — paste capture, chip styling, detail card
│   ├── index.js        # Host (node) half — intentionally empty (pure UI plugin)
│   └── parse.js        # Pure block-parsing logic (canonical, unit-tested)
├── tests/
│   └── parse.test.js   # node:test unit tests for src/parse.js
├── docs/
│   └── design.md       # Design rationale (numbering, anchor stability, codec)
├── cordis.patch.yml    # DSH bundle patch declaring the host plugin
├── package.json        # Package + DSH plugin manifest
├── README.md           # English
└── README.zh-CN.md     # 简体中文
```

## Development

```sh
npm run check   # syntax-check both JS halves
npm test        # run the unit tests (node:test)
```

MIT — see [LICENSE](./LICENSE).