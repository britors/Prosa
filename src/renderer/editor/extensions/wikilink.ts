// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { Mark, mergeAttributes } from '@tiptap/core';

export interface WikilinkOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikilink: {
      setWikilink: (attributes: { href: string }) => ReturnType;
      toggleWikilink: (attributes: { href: string }) => ReturnType;
    }
  }
}

export const Wikilink = Mark.create<WikilinkOptions>({
  name: 'wikilink',
  inclusive: false,
  addAttributes() {
    return {
      href: {
        default: null,
      },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'a[data-type="wikilink"]',
      },
    ]
  },
  renderHTML({ HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-type': 'wikilink', class: 'wikilink' }), 0]
  },
  addCommands() {
    return {
      setWikilink: (attributes) => ({ commands }) => {
        return commands.setMark('wikilink', attributes)
      },
      toggleWikilink: (attributes) => ({ commands }) => {
        return commands.toggleMark('wikilink', attributes)
      },
    }
  },
})
