// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { extractNumberedOutline } from './document-utils.js'
import type { TipTapJSON } from './types.js'

function tocBlocksFromOutline(doc: TipTapJSON, maxLevel: number, title: string): TipTapJSON[] {
  const outline = extractNumberedOutline(doc, maxLevel)
  const heading = {
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: title || 'Sumário' }]
  } satisfies TipTapJSON

  if (outline.length === 0) {
    return [
      heading,
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Nenhum título encontrado.' }]
      }
    ]
  }

  return [
    heading,
    {
      type: 'bulletList',
      content: outline.map((item) => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `${item.number} ${item.text}`.trim() }]
          }
        ]
      }))
    }
  ]
}

function walk(node: TipTapJSON, root: TipTapJSON): TipTapJSON[] {
  if (node.type === 'tableOfContents') {
    const maxLevel = Number(node.attrs?.maxLevel ?? 4)
    const title = typeof node.attrs?.title === 'string' ? node.attrs.title : 'Sumário'
    return tocBlocksFromOutline(root, maxLevel, title)
  }

  const next = {
    ...node,
    content: node.content?.flatMap((child) => walk(child, root))
  }

  return [next]
}

/** Expande blocos de sumário em conteúdo real com os títulos do documento. */
export function expandTableOfContents(doc: TipTapJSON): TipTapJSON {
  const content = doc.content?.flatMap((node) => walk(node, doc)) ?? []
  return { ...doc, content }
}
