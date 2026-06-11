// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Mark, mergeAttributes } from '@tiptap/core';

export interface CitationOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    citation: {
      setCitation: (attributes: { citeKey: string }) => ReturnType;
    }
  }
}

export const Citation = Mark.create<CitationOptions>({
  name: 'citation',
  inclusive: false,
  addAttributes() {
    return {
      citeKey: {
        default: null,
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="citation"]',
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'citation', class: 'citation' }), 0]
  },
  addCommands() {
    return {
      setCitation: (attributes) => ({ commands }) => {
        return commands.setMark('citation', attributes)
      },
    }
  },
})
