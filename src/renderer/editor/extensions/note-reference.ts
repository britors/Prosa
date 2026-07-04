// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Node, mergeAttributes } from '@tiptap/core'
import type { NoteKind } from '../../../shared/types.js'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    noteReference: {
      setNoteReference: (attributes: { noteId: string; kind: NoteKind }) => ReturnType
      updateNoteReference: (attributes: { noteId: string; kind: NoteKind }) => ReturnType
    }
  }
}

export const NoteReference = Node.create({
  name: 'noteReference',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      noteId: { default: '' },
      kind: { default: 'footnote' }
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="note-reference"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, { 'data-type': 'note-reference', class: 'note-reference' })]
  },

  addCommands() {
    return {
      setNoteReference:
        (attributes) =>
        ({ commands }) =>
          commands.insertContent({ type: 'noteReference', attrs: attributes }),
      updateNoteReference:
        (attributes) =>
        ({ commands }) =>
          commands.updateAttributes('noteReference', attributes)
    }
  }
})
