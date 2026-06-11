// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Mark, mergeAttributes } from '@tiptap/core';

export interface TagOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tag: {
      setTag: (attributes: { tagName: string }) => ReturnType;
      toggleTag: (attributes: { tagName: string }) => ReturnType;
    }
  }
}

export const Tag = Mark.create<TagOptions>({
  name: 'tag',
  inclusive: false,
  addAttributes() {
    return {
      tagName: {
        default: null,
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="tag"]',
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'tag', class: 'tag' }), 0]
  },
  addCommands() {
    return {
      setTag: (attributes) => ({ commands }) => {
        return commands.setMark('tag', attributes)
      },
      toggleTag: (attributes) => ({ commands }) => {
        return commands.toggleMark('tag', attributes)
      },
    }
  },
})
