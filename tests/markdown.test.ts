// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportMarkdown, importMarkdown } from '../src/main/converters.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const doc: TipTapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Um ' },
        { type: 'text', text: 'destaque', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' e um ' },
        { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://github.com/britors/Prosa' } }] },
        { type: 'text', text: '.' }
      ]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Primeiro' }] }]
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Segundo' }] }]
        }
      ]
    }
  ]
}

test('exporta TipTap JSON para Markdown com título', () => {
  const md = exportMarkdown(doc)
  assert.match(md, /^# Título/m)
})

test('exporta negrito e link em Markdown', () => {
  const md = exportMarkdown(doc)
  assert.match(md, /\*\*destaque\*\*/)
  assert.match(md, /\[link\]\(https:\/\/github\.com\/britors\/Prosa\)/)
})

test('exporta lista não ordenada em Markdown', () => {
  const md = exportMarkdown(doc)
  assert.match(md, /- Primeiro/)
  assert.match(md, /- Segundo/)
})

test('importa Markdown para HTML', () => {
  const html = importMarkdown('# Olá\n\nTexto com **negrito**.')
  assert.match(html, /<h1>Olá<\/h1>/)
  assert.match(html, /<strong>negrito<\/strong>/)
})

test('round-trip Markdown preserva título e ênfase', () => {
  const original = '# Documento\n\nTexto **importante** aqui.\n'
  const html = importMarkdown(original)
  assert.match(html, /<h1>Documento<\/h1>/)
  assert.match(html, /<strong>importante<\/strong>/)
})
