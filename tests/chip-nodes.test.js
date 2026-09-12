import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collectChipNodes, chipNodeOf } from '../src/chip-nodes.js'

/** Minimal stand-in for DSH's ReferenceChipNode. */
function chip(source, ref, extra = {}) {
  return {
    __source: source,
    __ref: ref,
    getSource() { return this.__source },
    getReference() { return this.__ref },
    remove() { this.removed = true },
    ...extra,
  }
}

const SOURCE = 'paste-code-block'

test('a node-map value IS a node (Lexical >= 0.21) and is recognized', () => {
  const node = chip(SOURCE, 'r1')
  // The v0.1.2 bug: the code read `value.node`, which is undefined for this
  // exact shape, so every delete silently matched nothing.
  assert.equal(node.node, undefined)
  assert.equal(chipNodeOf(node), node)
})

test('a legacy NodeState wrapper still resolves to its node', () => {
  const node = chip(SOURCE, 'r1')
  assert.equal(chipNodeOf({ node }), node)
})

test('non-node values normalize to null', () => {
  assert.equal(chipNodeOf(null), null)
  assert.equal(chipNodeOf(undefined), null)
  assert.equal(chipNodeOf({}), null)
  assert.equal(chipNodeOf({ node: null }), null)
  assert.equal(chipNodeOf({ node: { getSource: 'not a function' } }), null)
  assert.equal(chipNodeOf('text'), null)
})

test('collection matches one source + ref and ignores everything else', () => {
  const target = chip(SOURCE, 'r2')
  const otherRef = chip(SOURCE, 'r9')
  const otherSource = chip('dsh-file-upload', 'r2')
  const hit = collectChipNodes([target, otherRef, otherSource], SOURCE, 'r2')
  assert.deepEqual(hit, [target])
})

test('collection works on a Map.values() iterator (the real call shape)', () => {
  const target = chip(SOURCE, 'r2')
  const map = new Map([['k0', target], ['k1', chip(SOURCE, 'r1')], ['k2', { node: chip(SOURCE, 'r2') }]])
  assert.deepEqual(collectChipNodes(map.values(), SOURCE, 'r2'), [target, map.get('k2').node])
})

test('collection is non-empty for node-valued entries (v0.1.2 silent no-op regression)', () => {
  const values = [chip(SOURCE, 'r1'), chip(SOURCE, 'r2')]
  assert.equal(collectChipNodes(values, SOURCE, 'r2').length, 1)
  assert.equal(collectChipNodes(values, SOURCE, 'r3').length, 0)
})

test('duplicated chips for one ref are all collected', () => {
  const first = chip(SOURCE, 'r5')
  const second = chip(SOURCE, 'r5')
  assert.deepEqual(collectChipNodes([first, second], SOURCE, 'r5'), [first, second])
})

test('a missing/empty value list collects nothing', () => {
  assert.deepEqual(collectChipNodes(null, SOURCE, 'r1'), [])
  assert.deepEqual(collectChipNodes([], SOURCE, 'r1'), [])
})
