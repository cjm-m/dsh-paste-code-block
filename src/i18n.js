/**
 * dsh-paste-code-block — locale dictionaries and label logic (pure, no DOM).
 *
 * Canonical source for the user-visible names of pasted blocks ("代码块 1"
 * vs "Code #1", etc.). The browser half (`client.js`) embeds its own
 * copy of this logic because DSH's client module loader resolves *package
 * names*, not relative ESM files; this module is the single place where that
 * logic is unit-tested. **Keep `src/i18n.js` and the embedded copy in
 * `src/client.js` in sync.**
 *
 * Labels render through the DSH locale service (`ctx.locale`), whose
 * `t(key, params)` lookup walks the active language's fallback chain, so the
 * dictionaries below are the whole story: identical key sets in zh and en,
 * `{name}` placeholders for interpolation.
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'paste-code-block'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
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
}

/** English dictionary, key-identical to the Chinese source of truth. */
export const en = {
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
}

/** Shipped dictionaries keyed by locale id (mirrors DSH's built-in zh/en set). */
export const dictionaries = { zh, en }

/**
 * Pre-0.1.3 chip labels ("复制代码块N" / "Code block #N" …). No longer
 * rendered, but still recognized by `parseBlockLabel` so chips inserted by an
 * older bundle keep resolving to their block after an in-place page refresh.
 */
export const legacyLabels = {
  zh: { 'block.code': '复制代码块{n}', 'block.text': '复制文本块{n}' },
  en: { 'block.code': 'Code block #{n}', 'block.text': 'Text block #{n}' },
}

/**
 * Standalone translator used only when no DSH locale service is present
 * (defensive fallback outside the standard web composition). English is the
 * fallback language, matching DSH's own `FALLBACK_LOCALE`.
 */
export function createT(locale) {
  const dict = dictionaries[locale] || dictionaries.en
  return (key, params) => {
    let text = dict[key] != null ? dict[key] : (dictionaries.en[key] != null ? dictionaries.en[key] : key)
    if (params) text = text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
    return text
  }
}

/** Guess a locale id from the browser's language list (fallback path only). */
export function detectBrowserLocale() {
  try {
    const langs = [...(navigator.languages || []), navigator.language].filter(Boolean).map((l) => String(l).toLowerCase())
    return langs.some((l) => l.startsWith('zh')) ? 'zh' : 'en'
  } catch (e) {
    return 'en'
  }
}

/** Build a block chip label from a translator: 代码块 2 / Code #2. */
export function blockLabel(t, type, n) {
  return t(type === 'code' ? 'block.code' : 'block.text', { n })
}

/**
 * Recognize a rendered block label in ANY shipped locale (or a pre-0.1.3
 * legacy locale) and recover its `{ type, n }` identity. This lets a chip
 * click, an ✕ delete, and the locale-switch retitling find the right block
 * even when the chip was inserted under a different language than the one
 * currently active. Returns null for anything that is not a block label.
 */
export function parseBlockLabel(text) {
  if (!text) return null
  for (const dict of [dictionaries.zh, dictionaries.en, legacyLabels.zh, legacyLabels.en]) {
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
