import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlock, detectLang, serializeBlock, splitFencedSegments } from '../src/parse.js'

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

// ===== splitFencedSegments (sent-message fold segmentation) ================
test('empty text yields no segments', () => {
  assert.deepEqual(splitFencedSegments(''), [])
  assert.deepEqual(splitFencedSegments(null), [])
})

test('prose-only text is one prose segment', () => {
  const segs = splitFencedSegments('hello\nworld')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'prose')
  assert.equal(segs[0].text, 'hello\nworld')
})

test('a single fenced block is extracted with lang, body and raw', () => {
  const text = '```python\ndef f():\n    pass\n```'
  const segs = splitFencedSegments(text)
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'fence')
  assert.equal(segs[0].lang, 'python')
  assert.equal(segs[0].body, 'def f():\n    pass')
  assert.equal(segs[0].raw, text)
})

test('prose around fences is kept verbatim and in order', () => {
  const text = '看一下\n```js\nconst x = 1;\n```\n最后一个问题'
  const segs = splitFencedSegments(text)
  assert.deepEqual(segs.map((s) => s.kind), ['prose', 'fence', 'prose'])
  assert.equal(segs[0].text, '看一下')
  assert.equal(segs[1].lang, 'js')
  assert.equal(segs[2].text, '最后一个问题')
})

test('two serialized plugin blocks split apart with blank prose', () => {
  // serializeBlock emits `\n```text\n…\n```\n` per block — back to back.
  const text = '\n```text\nfirst block\n```\n\n```python\nprint(1)\n```\n'
  const segs = splitFencedSegments(text)
  const fences = segs.filter((s) => s.kind === 'fence')
  assert.equal(fences.length, 2)
  assert.equal(fences[0].body, 'first block')
  assert.equal(fences[1].body, 'print(1)')
})

test('tilde fences and info strings with extra words', () => {
  const segs = splitFencedSegments('~~~yaml title: a\nkey: value\n~~~')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'fence')
  assert.equal(segs[0].lang, 'yaml')
  assert.equal(segs[0].body, 'key: value')
})

test('a longer fence wraps inner shorter fences', () => {
  const text = '````markdown\n```js\nx\n```\n````'
  const segs = splitFencedSegments(text)
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'fence')
  assert.equal(segs[0].lang, 'markdown')
  assert.equal(segs[0].body, '```js\nx\n```')
})

test('unterminated fences stay prose', () => {
  const segs = splitFencedSegments('before\n```json\n{"a": 1}')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'prose')
  assert.equal(segs[0].text, 'before\n```json\n{"a": 1}')
})

test('fence indented up to 3 spaces opens; 4+ stays prose (indented code)', () => {
  const ok = splitFencedSegments('  ```\nx\n  ```')
  assert.equal(ok.length, 1)
  assert.equal(ok[0].kind, 'fence')
  const deep = splitFencedSegments('    ```\n    x\n    ```')
  assert.equal(deep.length, 1)
  assert.equal(deep[0].kind, 'prose')
})

test('backticks inside a ``` info string mean prose, not a fence', () => {
  const segs = splitFencedSegments('```weird `tick`\nbody\n```')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'prose')
})

test('empty-body fence is still reported as a fence segment', () => {
  const segs = splitFencedSegments('```\n```')
  assert.equal(segs.length, 1)
  assert.equal(segs[0].kind, 'fence')
  assert.equal(segs[0].body, '')
})