/**
 * Chip-node helpers for the composer editor.
 *
 * DSH renders each reference (our pasted block) as a Lexical decorator chip.
 * The input shell exposes no per-reference delete verb, so removal reaches the
 * node map (`editor.getEditorState()._nodeMap`) and drops the matching node.
 *
 * The node map is keyed by NodeKey and its VALUES ARE THE NODES THEMSELVES
 * (Lexical >= 0.21, verified against 0.49.0 by tests/lexical-chip-probe.mjs).
 * The older `NodeState` wrapper with a `.node` field is gone, so reading
 * `value.node` yields undefined for every entry — which is exactly how v0.1.2's
 * delete turned into a silent no-op instead of deleting the block.
 *
 * Pure and dependency-free so the shape rule is unit-testable; keep the
 * embedded copy in src/client.js in sync (same rule as parse.js/i18n.js).
 */

/**
 * Normalize one node-map value to a chip-like node.
 * @param value - raw node-map value (a node, or a legacy NodeState wrapper).
 * @returns the node when it exposes the chip accessors, else null.
 */
export function chipNodeOf(value) {
  if (!value) return null
  if (typeof value.getSource === 'function') return value
  const wrapped = value.node
  return wrapped && typeof wrapped.getSource === 'function' ? wrapped : null
}

/**
 * Collect the chip node(s) belonging to one source + ref.
 * @param values - node-map values (`map.values()`).
 * @param source - owning reference source (e.g. 'paste-code-block').
 * @param ref - owner-scoped reference id (the block id).
 * @returns matching nodes, in map order (usually exactly one).
 */
export function collectChipNodes(values, source, ref) {
  const hits = []
  if (!values) return hits
  for (const value of values) {
    const node = chipNodeOf(value)
    if (!node || typeof node.getReference !== 'function') continue
    if (node.getSource() === source && node.getReference() === ref) hits.push(node)
  }
  return hits
}
