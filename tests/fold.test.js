// Regression tests for the "pasted block is rendered wrong in the sent message" bug.
//
// Two real shapes are under test (see fixtures.js, captured from the user's own
// session logs):
//   P  the prose the user originally pasted
//   W  what 0.2.5 serialised it to - a clean ```text fence plus a typed tail
//   B  what 0.2.5 produced when W was pasted back in: a BARE fence wrapped
//      around an already-fenced text, which is what broke the transcript.
//
// Run: node --test      (from the package root)
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseBlock,
  serializeBlock,
  splitFencedSegments,
  wholeFence,
  fenceMarkerFor,
  fenceRanges,
  planFoldRuns,
} from '../src/parse.js'
import { W, B, B2, P } from './fixtures.js'

const lf = (s) => s.replace(/\r\n/g, '\n')
const unwrap = (s) => s.replace(/^\n/, '').replace(/\n$/, '')

// DSH renders a sent user message as ONE plain-text run per @mention chip: the
// chip keeps only the label (the part after the last "/"), so the run before it
// stops at the "@".  Mirrors what the transcript really contains.
function dshRuns(message) {
  const out = []
  const re = /@([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)/g
  let last = 0
  let m
  while ((m = re.exec(message)) !== null) {
    out.push(message.slice(last, m.index))
    out.push(m[1].split('/').pop())
    last = m.index + m[0].length
  }
  out.push(message.slice(last))
  return out
}

test('a plain prose paste becomes a TEXT block with one clean fence', () => {
  const block = parseBlock(P)
  assert.equal(block.isCode, false)
  assert.equal(unwrap(serializeBlock(block)), '```text\n' + P + '\n```')
  // ... which is exactly the prefix of the message the user actually sent.
  assert.ok(W.startsWith('```text\n' + P))
})

test('0.2.5 broke when the previous message was pasted back (real captured data)', () => {
  // B is W wrapped in one extra BARE fence - the reported breakage.
  assert.ok(B.startsWith('```\n```text'))
  assert.equal(lf(B), lf('```\n' + W + '\n```'))
})

test('re-pasting the previous message now stays a TEXT block (the user bug)', () => {
  const block = parseBlock(W)
  assert.equal(block.isCode, false, 'W was mis-typed as CODE by 0.2.5')
  const sent = serializeBlock(block)
  // The wrapper marker grows so the inner ``` fence can never close it.
  assert.ok(sent.startsWith('\n````text\n'), 'wrapper marker must grow past the body fences')
  assert.equal(unwrap(sent), '````text\n' + W + '\n````')
  assert.notEqual(unwrap(sent), B, 'must not reproduce the 0.2.5 output')
})

test('the whole-bubble plan sees the fence that straddles DSH mention chips', () => {
  const runs = dshRuns(B2)
  assert.deepEqual(runs.map((r) => r.length), [16, 37, 71, 37, 281])
  const plan = planFoldRuns(B2, runs)
  assert.equal(plan.mode, 'bubble')
  assert.equal(plan.fences.length, 1)
  // Same answer when the message still carries CRLF from the Windows clipboard.
  assert.equal(planFoldRuns(B, dshRuns(B)).mode, 'bubble')
})

test('per-run scanning is what produced the bogus one-line card', () => {
  for (const [msg, tailBody] of [[B, '解决这个'], [B2, '测试，不需要执行']]) {
    const runs = dshRuns(msg)
    const tail = runs[runs.length - 1]
    const fences = splitFencedSegments(tail).filter((s) => s.kind === 'fence')
    assert.equal(fences.length, 1)
    assert.equal(fences[0].body.trim(), tailBody)
  }
})

test('a fence that sits inside a single run keeps the per-run path', () => {
  const msg = '看这个 @a/b\n```js\nconst a = 1\n```\n谢谢'
  const runs = dshRuns(msg)
  const plan = planFoldRuns(msg, runs)
  assert.equal(plan.mode, 'single')
  assert.deepEqual(plan.runs, [2])
})

test('prose alone plans no fold', () => {
  assert.equal(planFoldRuns(P, [P]), null)
  assert.equal(planFoldRuns('hello\nworld\n', ['hello\nworld\n']), null)
})

test('fenceRanges agrees with splitFencedSegments', () => {
  const samples = [W, B, B2, '````text\na\n```\nb\n```\n````', '前言\n```\nx\n```\n后记']
  for (const s of samples) {
    const segs = splitFencedSegments(s).filter((x) => x.kind === 'fence')
    const ranges = fenceRanges(s)
    assert.equal(ranges.length, segs.length, `range count for ${JSON.stringify(s.slice(0, 12))}`)
    // splitFencedSegments rebuilds raw/body from line arrays, so it normalises
    // CRLF to LF; the offsets themselves must still line up exactly.
    segs.forEach((seg, i) => assert.equal(lf(s.slice(ranges[i].start, ranges[i].end)), seg.raw))
  }
})

test('a clean fenced paste takes its type from the info string', () => {
  assert.equal(parseBlock('```text\nhello\n```').isCode, false)
  assert.equal(parseBlock('```text\nhello\n```').lang, '')
  const js = parseBlock('```js\nconst a = 1\n```')
  assert.equal(js.isCode, true)
  assert.equal(js.lang, 'js')
  assert.equal(unwrap(serializeBlock(js)), '```js\nconst a = 1\n```')
  // Bare fence with no info string stays code.
  assert.equal(parseBlock('```\nhello\n```').isCode, true)
})

test('wholeFence only matches a fence that is the whole paste', () => {
  assert.equal(wholeFence('```text\nx\n```').lang, 'text')
  assert.equal(wholeFence('```text\nx\n```\n尾注'), null)
  assert.ok(wholeFence('\n```text\nx\n```\n'), 'blank lines around the fence are tolerated')
  assert.equal(wholeFence('前言\n```text\nx\n```'), null)
  assert.equal(wholeFence('no fence here'), null)
})

test('the wrapper marker always outgrows the body', () => {
  assert.equal(fenceMarkerFor('no fences'), '```')
  assert.equal(fenceMarkerFor('a\n```\nb\n```'), '````')
  assert.equal(fenceMarkerFor('`````'), '``````')
  const nested = unwrap(serializeBlock(parseBlock(W)))
  assert.equal(fenceMarkerFor(nested), '`````')
})

test('re-pasting the fixed output is stable', () => {
  const once = unwrap(serializeBlock(parseBlock(W)))
  const twice = unwrap(serializeBlock(parseBlock(once)))
  // Stable modulo the CRLF -> LF normalisation splitFencedSegments performs.
  assert.equal(lf(twice), lf(once))
  assert.equal(planFoldRuns(once, [once]).mode, 'single')
})
