// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandTableOfContents } from '../src/shared/table-of-contents.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

test('expandTableOfContents substitui o bloco por conteúdo gerado', () => {
  const doc: TipTapJSON = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Introdução' }] },
      {
        type: 'tableOfContents',
        attrs: { title: 'Sumário', maxLevel: 2 }
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Detalhes' }] }
    ]
  }

  const expanded = expandTableOfContents(doc)
  const content = expanded.content ?? []

  assert.equal(content[0].type, 'heading')
  assert.equal(content[1].type, 'heading')
  assert.equal(content[1].content?.[0].text, 'Sumário')
  assert.equal(content[2].type, 'bulletList')
  assert.equal(content[2].content?.[0].content?.[0].content?.[0].text, '1 Introdução')
  assert.equal(content[2].content?.[1].content?.[0].content?.[0].text, '1.1 Detalhes')
})
