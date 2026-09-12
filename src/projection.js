/**
 * Composer-projection geometry.
 *
 * The input shell publishes two coordinate systems for the same document:
 *
 * - `draft` (clipboard projection): every chip expands to its `clipboardText`,
 *   so a chip occupies `occurrence.length` characters.
 * - the editor's detect projection (what the scoped edit verbs address): every
 *   chip collapses to exactly ONE placeholder character (U+FFFC), while plain
 *   text is identical in both.
 *
 * Editing verbs (`slash/input-insert-text`, chip insertion) take detect spans,
 * so clipboard offsets must be converted before addressing an occurrence.
 *
 * Pure and dependency-free so the conversion is unit-testable; keep the embedded
 * copy in src/client.js in sync (same rule as parse.js/i18n.js/chip-nodes.js).
 */

/**
 * Convert one occurrence's clipboard offset into a detect offset.
 * @param occurrences - all occurrences of the same projection.
 * @param occ - the occurrence to convert.
 * @returns the detect offset where the occurrence's placeholder sits.
 */
export function detectOffsetOf(occurrences, occ) {
  let shift = 0
  for (const other of occurrences || []) {
    if (other === occ || other.offset >= occ.offset) continue
    shift += Math.max(0, (other.length || 1) - 1)
  }
  return occ.offset - shift
}

/**
 * Detect span of the separating space the shell appends right after a freshly
 * inserted chip — or null when the character after that chip is not a space.
 *
 * `SessionInputShell.insertReference` inserts `[chip, ' ']` whenever the
 * character at the pick-time span is not itself a space. Blocks are inserted at
 * the end of the draft, so that character can only have come from the insertion
 * itself: removing it never touches a space the draft already contained.
 *
 * @param projection - published input state (`{ draft, occurrences }`).
 * @param occ - OUR chip, the one that was just inserted.
 * @returns `{ start, end }` in detect coordinates, or null.
 */
export function separatorSpaceSpan(projection, occ) {
  if (!projection || !occ) return null
  const draft = projection.draft || ''
  const afterChip = occ.offset + (occ.length || 0)
  if (draft.charAt(afterChip) !== ' ') return null
  const start = detectOffsetOf(projection.occurrences, occ) + 1
  return { start, end: start + 1 }
}
