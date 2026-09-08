import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlock, detectLang, serializeBlock } from '../src/parse.js'

test('ordinary short prose is not treated as a block', () => {
  assert.equal(parseBlock('hello world'), null)
  assert.equal(parseBlock('a'), null)
})

test('multi-line text becomes a block', () => {
  const b = parseBlock('line one\nline two\nline three')
  assert.ok(b)
  assert.equal(b.isCode, false)
  assert.equal(b.lines.length, 3)
})

test('a short line below the length threshold is null', () => {
  // 95 chars, no newline, no fences, no indent -> not a block
  const s = 'a'.repeat(95)
  assert.equal(parseBlock(s), null)
})

test('a long single line is treated as a block', () => {
  // >= 96 chars, no newline -> still a block (length rule)
  const s = 'a'.repeat(96)
  assert.ok(parseBlock(s))
})

test('fenced code block is parsed with its language tag', () => {
  const raw = '```js\nconst x = 1;\n```'
  const b = parseBlock(raw)
  assert.ok(b)
  assert.equal(b.isCode, true)
  assert.equal(b.lang, 'js')
  assert.equal(b.content, 'const x = 1;')
})

test('fenced block with no language tags as empty lang but still code', () => {
  const b = parseBlock('```\nplain\n```')
  assert.ok(b)
  assert.equal(b.isCode, true)
  assert.equal(b.lang, '')
})

test('indented, brace-dense code is detected as code', () => {
  const raw = '  function main() {\n    console.log("hi")\n    return 0;\n  }'
  const b = parseBlock(raw)
  assert.ok(b)
  assert.equal(b.isCode, true)
  assert.equal(b.lang, 'javascript')
})

test('python shebang is detected', () => {
  const raw = '#!/usr/bin/env python3\nprint("hi")'
  const b = parseBlock(raw)
  assert.ok(b)
  assert.equal(b.isCode, true)
  assert.equal(b.lang, 'python')
})

test('markdown prose with several signals is text, not code', () => {
  const md = '# Title\n\nSome **bold** text with a [link](https://x.test).\n\n- item\n- item2'
  const b = parseBlock(md)
  assert.ok(b)
  assert.equal(b.isCode, false)
})

test('empty input returns null', () => {
  assert.equal(parseBlock(''), null)
  assert.equal(parseBlock(null), null)
  assert.equal(parseBlock(undefined), null)
})

test('detectLang: common languages', () => {
  assert.equal(detectLang('const a = 1;'), 'javascript')
  assert.equal(detectLang('def foo():'), 'python')
  assert.equal(detectLang('SELECT * FROM t'), 'sql')
  assert.equal(detectLang('{"a":1}'), 'json')
  assert.equal(detectLang('<root></root>'), 'xml')
  assert.equal(detectLang(''), '')
})

test('serializeBlock wraps plain text in a text fence', () => {
  const b = parseBlock('line one\nline two')
  assert.ok(b)
  assert.equal(serializeBlock(b), '\n```text\nline one\nline two\n```\n')
})

test('serializeBlock preserves the detected language for code', () => {
  const b = parseBlock('function main() {\n  console.log(1)\n}')
  assert.ok(b)
  assert.equal(b.isCode, true)
  assert.equal(b.lang, 'javascript')
  assert.ok(serializeBlock(b).startsWith('\n```javascript\n'))
})