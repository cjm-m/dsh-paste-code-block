// Reproduction probe for the chip-removal node-map shape (NOT part of the test
// glob: it needs optional deps, so CI never runs it).
//
//   npm i --no-save lexical@0.49.0 @lexical/headless@0.49.0
//   node tests/lexical-chip-probe.mjs
//
// Expected output:
//   _nodeMap value shape: valueIsNode true, hasNodeProp false
//   OLD code (value.node):    removed = 0  | refs after = r1,r2,r3   <- v0.1.2 silent no-op
//   NEW code (value is node): removed = 1  | refs after = r1,r3
import { createHeadlessEditor } from '@lexical/headless'
import { $createParagraphNode, $createTextNode, $getRoot, DecoratorNode } from 'lexical'

const SOURCE = 'paste-code-block'

class ReferenceChipNode extends DecoratorNode {
  static getType() { return 'reference-chip' }
  static clone(node) { return new ReferenceChipNode(node.__source, node.__ref, node.__label, node.__key) }
  constructor(source = SOURCE, ref = '', label = '', key) {
    super(key)
    this.__source = source
    this.__ref = ref
    this.__label = label
  }
  createDOM() { return document.createElement('span') }
  updateDOM() { return false }
  isInline() { return true }
  isKeyboardSelectable() { return false }
  getSource() { return this.__source }
  getReference() { return this.__ref }
  getLabel() { return this.__label }
}

function freshEditor() {
  const editor = createHeadlessEditor({
    namespace: 'probe',
    nodes: [ReferenceChipNode],
    onError: (err) => { throw err },
  })
  editor.update(() => {
    const p = $createParagraphNode()
    p.append($createTextNode('alpha '))
    p.append(new ReferenceChipNode(SOURCE, 'r1', 'block 1'))
    p.append(new ReferenceChipNode(SOURCE, 'r2', 'block 2'))
    p.append(new ReferenceChipNode(SOURCE, 'r3', 'block 3'))
    p.append($createTextNode(' omega'))
    const root = $getRoot()
    root.clear()
    root.append(p)
  }, { discrete: true })
  return editor
}

function refsOf(editor) {
  let refs = []
  editor.getEditorState().read(() => {
    refs = $getRoot().getChildren()[0].getChildren()
      .filter((n) => typeof n.getSource === 'function')
      .map((n) => n.getReference())
  })
  return refs
}

function shapeOf(editor) {
  const found = []
  editor.getEditorState().read(() => {
    const map = editor.getEditorState()._nodeMap
    for (const [key, value] of map) {
      if (typeof value.getSource === 'function') {
        found.push({ valueIsNode: true, hasNodeProp: 'node' in value, key: value.getKey() === key })
      } else if (value && value.node) {
        found.push({ valueIsNode: false, hasNodeProp: true, key: value.node.getKey() === key })
      }
    }
  })
  return found
}

function removeWith(editor, pick) {
  let hits = 0
  editor.update(() => {
    const map = editor.getEditorState()._nodeMap
    const targets = []
    for (const value of map.values()) {
      const node = pick(value)
      if (!node || typeof node.getSource !== 'function' || typeof node.getReference !== 'function') continue
      if (node.getSource() === SOURCE && node.getReference() === 'r2') targets.push(node)
    }
    for (const node of targets) node.remove()
    hits = targets.length
  }, { discrete: true })
  return hits
}

const probe = freshEditor()
console.log('1) _nodeMap value shape:', JSON.stringify(shapeOf(probe)))

const oldWay = freshEditor()
console.log('2) OLD code (value.node):   removed =', removeWith(oldWay, (v) => v && v.node), '| refs after =', refsOf(oldWay).join(','))

const newWay = freshEditor()
console.log('3) NEW code (value is node): removed =', removeWith(newWay, (v) => (v && typeof v.getSource === 'function' ? v : v && v.node)), '| refs after =', refsOf(newWay).join(','))

const textAfter = (editor) => {
  let text = ''
  editor.getEditorState().read(() => { text = $getRoot().getTextContent() })
  return text
}
console.log('4) draft text after NEW removal:', JSON.stringify(textAfter(newWay)))
