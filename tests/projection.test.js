import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectOffsetOf, separatorSpaceSpan } from '../src/projection.js'

/** Occurrence factory: our chips project as one zero-width char. */
function occ(offset, { length = 1, source = 'paste-code-block', ref = 'r1' } = {}) {
  return { offset, length, source, ref }
}

test('detect offset equals the clipboard offset when no chip precedes', () => {
  const c = occ(4)
  assert.equal(detectOffsetOf([c], c), 4)
})

test('a preceding foreign chip (longer clipboard text) shifts detect offsets', () => {
  const fileChip = occ(0, { length: 5, source: 'dsh-file-upload', ref: 'f1' })
  const block = occ(5, { ref: 'r1' })
  assert.equal(detectOffsetOf([fileChip, block], block), 1)
})

test('trailing occurrences never shift an earlier one', () => {
  const block = occ(0, { ref: 'r1' })
  const later = occ(9, { length: 5, source: 'dsh-file-upload', ref: 'f2' })
  assert.equal(detectOffsetOf([block, later], block), 0)
})

test('separator space right after our chip is located in detect coordinates', () => {
  const block = occ(0)
  const projection = { draft: '\u200B ', occurrences: [block] }
  assert.deepEqual(separatorSpaceSpan(projection, block), { start: 1, end: 2 })
})

test('separator span accounts for chips that precede ours', () => {
  const fileChip = occ(0, { length: 5, source: 'dsh-file-upload', ref: 'f1' })
  const block = occ(5)
  // clipboard: [file(0..5)][chip(5)][' '(6)] -> detect: [file=1][chip][space]
  const projection = { draft: '/file\u200B ', occurrences: [fileChip, block] }
  assert.deepEqual(separatorSpaceSpan(projection, block), { start: 2, end: 3 })
})

test('a pre-existing space before the chip is not what gets removed', () => {
  const block = occ(4)
  // "abc " was typed by the user; the chip was appended, then the shell's space.
  const projection = { draft: 'abc \u200B ', occurrences: [block] }
  const span = separatorSpaceSpan(projection, block)
  assert.deepEqual(span, { start: 5, end: 6 })
  // the character under the span is the appended one, not the user's space
  assert.equal(projection.draft.charAt(4), '\u200B')
  assert.equal(projection.draft.charAt(3), ' ')
  assert.equal(projection.draft.charAt(span.start), ' ')
})

test('no span when the character after our chip is not a space', () => {
  const block = occ(0)
  assert.equal(separatorSpaceSpan({ draft: '\u200B', occurrences: [block] }, block), null)
  assert.equal(separatorSpaceSpan({ draft: '\u200Btext', occurrences: [block] }, block), null)
})

test('missing projection or occurrence yields no span', () => {
  const block = occ(0)
  assert.equal(separatorSpaceSpan(null, block), null)
  assert.equal(separatorSpaceSpan({ draft: '\u200B ', occurrences: [] }, null), null)
})
