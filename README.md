<div align="center">

# dsh-paste-code-block

**Cherry Studio‑style text/code block pasting for DeepSeek Harness Web**

Paste long code or text into the DSH Web composer → it lands as a **bordered, collapsible, language‑tagged card** instead of a wall of text. Names follow the DSH interface language (中文 / English). On send, the original content is restored as a fenced code block.

[![npm version](https://img.shields.io/npm/v/dsh-paste-code-block?logo=npm)](https://www.npmjs.com/package/dsh-paste-code-block)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![platform: web](https://img.shields.io/badge/platform-DSH%20Web-blueviolet)](https://github.com/deepseek-ai/deepseek-harness)

**English | [简体中文](./README.zh-CN.md)**

</div>

![Preview — pasted blocks become tidy cards](./docs/images/hero.png)

## Why

Copying a 200‑line stack trace, an API response, or a long log into a chat input turns the composer into an unreadable blob. This plugin folds any qualifying paste into a **chip** (built on DSH's own hidden‑reference mechanism, the same one file uploads use) plus an **editing detail card** — the draft stays clean, and the content stays fully editable and restorable.

## Features

- 🧩 **Auto block detection** — pasted text with ``` fences, newlines, heavy indentation, or length ≥ 96 becomes a card; ordinary short prose pastes through untouched.
- 🏷️ **Language tags** — auto-detects Python / JS / JSON / YAML / SQL / bash / HTML·XML / C++ / Go / Ruby (incl. shebangs); plain-text blocks are tagged `text`.
- ✏️ **In-card editing** — edit the content right in the detail card; the edited text is exactly what gets sent. Plus copy, collapse/expand, and hide.
- 🈯 **Localized names** — chips are named in the current DSH language: `代码块 1` / `Code #1`, `文本块 N` / `Text #N`. A leading glyph and tint tells the two apart at a glance — `</>` blue for code, `Aa` gray for text. Switching **Settings → Language** live-retitles every chip.
- × **One-click remove** — every chip carries its own `×` delete button (the detail card has one too); a removed number is recycled immediately.
- 📤 **Fenced restore on send** — each card expands back into a ```` ```lang … ``` ```` block when you send; a failed send automatically refills the input.
- 🔢 **Smart numbering** — code and text count apart; the smallest free number is always reused.
- 📱 **Every surface** — pure client plugin; works on desktop & mobile web, follows light/dark themes.

## How it works

![Four steps: copy · paste · tidy · send](./docs/images/workflow.png)

## Localization

Chip labels, tooltips, line counts, and the send-time error notice all render through the official DSH locale service: the plugin registers a `paste-code-block` dictionary namespace with complete **zh / en** key sets, and its composer dock declares that namespace, so everything re-renders on every language switch.

![Block names follow the UI language](./docs/images/languages.png)

- **New pastes** are named in whatever language is active at paste time.
- **Existing chips** are re-titled live when you flip 设置 → 语言 / Settings → Language — no reload needed.
- Clicks and deletes match chips **across languages**: a `代码块 2` chip still resolves to its block after switching to English (where it now reads `Code #2`), and vice versa.

## Install

Requires DSH `0.1.x` (developer preview — APIs may change). Published on **npm** — install by name:

```sh
dsh plugin --profile web add dsh-paste-code-block
```

Or from this repository / a local checkout:

```sh
dsh plugin --profile web add github:cjm-m/dsh-paste-code-block   # from GitHub
dsh plugin --profile web add file:/path/to/dsh-paste-code-block  # from a local folder
```

**Restart `dsh web`** after installing.

## Usage

1. Copy any code or multi-line text from anywhere.
2. Paste into the DSH input → it collapses into a chip such as `代码块 1` / `Code #1`.
3. Click the chip to open the card: read, edit inline, copy, collapse. Click the chip's (or the card's) `×` to delete that block.
4. Send — the full original text goes out as a proper fenced code block.

Detection threshold: **contains a newline / ≥ 2 lines / length ≥ 96 / indented & brace-dense / fenced** — any one turns the paste into a block.

## Notes & boundaries

- Blocks are **appended at the end of the draft** (reusing DSH's hidden-reference semantics), which keeps cursor/undo stable.
- Plain-text blocks are sent wrapped in ```` ```text ``` ```` so they never smear into one line.
- Removing a chip any other way (e.g. `Backspace`) also frees its number — plugin state is reconciled against the editor continuously.
- Deleting one block never touches the others, and removal is an ordinary editor edit — `Ctrl+Z` brings it back.
- Creating a block leaves **no stray space**: DSH appends a separating space after a freshly inserted chip, and the plugin removes exactly that one character, so text typed after a block does not start with a space and pasting several blocks never piles spaces into the message. Spaces you typed yourself are never touched by pasting or deleting.

## Project layout

```
dsh-paste-code-block/
├── src/
│   ├── client.js       # Web (browser) half — paste capture, chips, detail card, × delete
│   ├── index.js        # Host (node) half — intentionally empty (pure UI plugin)
│   ├── parse.js        # Pure block-detection logic (canonical, unit-tested)
│   └── i18n.js         # Locale dictionaries + label parsing (canonical, unit-tested)
├── tests/
│   ├── parse.test.js   # node:test unit tests for src/parse.js
│   └── i18n.test.js    # node:test unit tests for src/i18n.js
├── docs/
│   ├── design.md       # Design rationale (numbering, anchors, codec, i18n, chip ×)
│   └── images/         # README mockups (PNG + editable SVG sources)
├── cordis.patch.yml    # DSH bundle patch declaring the host plugin
├── package.json        # Package + DSH plugin manifest
├── README.md           # English
└── README.zh-CN.md     # 简体中文
```

## Development

```sh
npm run check   # syntax-check the JS halves
npm test        # run unit tests (node:test, 38 tests)
```

## License

MIT — see [LICENSE](./LICENSE).
