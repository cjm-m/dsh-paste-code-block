import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NS, zh, en, dictionaries, createT, blockLabel, parseBlockLabel, detectBrowserLocale,
} from '../src/i18n.js'

test('namespace is the plugin source name', () => {
  assert.equal(NS, 'paste-code-block')
})

test('zh and en dictionaries carry identical key sets', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys)
  assert.ok(zhKeys.length >= 10, 'dictionaries should be reasonably complete')
})

test('block labels render in both locales with the number interpolated', () => {
  assert.equal(blockLabel(createT('zh'), 'code', 2), '复制代码块2')
  assert.equal(blockLabel(createT('zh'), 'text', 7), '复制文本块7')
  assert.equal(blockLabel(createT('en'), 'code', 2), 'Code block #2')
  assert.equal(blockLabel(createT('en'), 'text', 7), 'Text block #7')
})

test('parseBlockLabel round-trips every locale and both block types', () => {
  for (const locale of ['zh', 'en']) {
    const t = createT(locale)
    for (const type of ['code', 'text']) {
      for (const n of [1, 2, 9, 10, 123]) {
        const label = blockLabel(t, type, n)
        assert.deepEqual(parseBlockLabel(label), { type, n }, `${locale} ${type} #${n}`)
      }
    }
  }
})

test('a label in one language still parses while the other is active', () => {
  // Chips keep the insert-time label until the client retitles them; identity
  // recovery must be locale-independent either way.
  assert.deepEqual(parseBlockLabel('复制代码块3'), { type: 'code', n: 3 })
  assert.deepEqual(parseBlockLabel('Text block #4'), { type: 'text', n: 4 })
})

test('parseBlockLabel rejects anything that is not a block label', () => {
  assert.equal(parseBlockLabel(''), null)
  assert.equal(parseBlockLabel(null), null)
  assert.equal(parseBlockLabel('Code block x'), null)
  assert.equal(parseBlockLabel('Code block #x'), null)
  assert.equal(parseBlockLabel('复制代码块'), null)
  assert.equal(parseBlockLabel('复制文本块abc'), null)
  assert.equal(parseBlockLabel('Hello world'), null)
  assert.equal(parseBlockLabel('Pasted Code Block 1'), null)
})

test('createT interpolates params, falls back to en, then to the raw key', () => {
  const t = createT('zh')
  assert.equal(t('lines.other', { count: 5 }), '5 行')
  assert.equal(createT('en')('lines.one', { count: 1 }), '1 line')
  assert.equal(createT('en')('lines.other', { count: 2 }), '2 lines')
  // missing param keeps the placeholder
  assert.equal(t('lines.other'), '{count} 行')
  // unknown key with an en counterpart falls through to en
  assert.equal(t('detail.aria'), '代码块详情')
  assert.equal(createT('fr')('detail.aria'), 'Block details') // unknown locale -> en
  // unknown key everywhere -> the key itself
  assert.equal(t('no.such.key'), 'no.such.key')
})

test('dictionaries map exposes both locales', () => {
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
})

test('detectBrowserLocale never throws outside a browser', () => {
  assert.ok(['zh', 'en'].includes(detectBrowserLocale()))
})
