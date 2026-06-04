// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportOdt, importOdt } from '../src/main/odt.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const doc: TipTapJSON = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Documento LibreOffice' }]
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Texto com ' },
        { type: 'text', text: 'negrito', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' e ' },
        { type: 'text', text: 'itálico', marks: [{ type: 'italic' }] },
        { type: 'text', text: '.' }
      ]
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Maçã' }] }]
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Banana' }] }]
        }
      ]
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Coluna' }] }]
            }
          ]
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Célula' }] }]
            }
          ]
        }
      ]
    }
  ]
}

test('exporta para um buffer .odt válido (assinatura ZIP)', async () => {
  const buffer = await exportOdt(doc)
  assert.ok(buffer.length > 0)
  // .odt é um ZIP: começa com a assinatura "PK".
  assert.equal(buffer[0], 0x50)
  assert.equal(buffer[1], 0x4b)
})

test('round-trip .odt preserva título', async () => {
  const buffer = await exportOdt(doc)
  const html = await importOdt(buffer)
  assert.match(html, /<h1>Documento LibreOffice<\/h1>/)
})

test('round-trip .odt preserva negrito e itálico', async () => {
  const buffer = await exportOdt(doc)
  const html = await importOdt(buffer)
  assert.match(html, /<strong>negrito<\/strong>/)
  assert.match(html, /<em>itálico<\/em>/)
})

test('round-trip .odt preserva lista não ordenada', async () => {
  const buffer = await exportOdt(doc)
  const html = await importOdt(buffer)
  assert.match(html, /<ul>/)
  assert.match(html, /Maçã/)
  assert.match(html, /Banana/)
})

test('round-trip .odt preserva tabela', async () => {
  const buffer = await exportOdt(doc)
  const html = await importOdt(buffer)
  assert.match(html, /<table>/)
  assert.match(html, /Célula/)
})

test('exporta documento .odt vazio sem erro', async () => {
  const buffer = await exportOdt({ type: 'doc', content: [] })
  assert.ok(buffer.length > 0)
  assert.equal(buffer[0], 0x50)
})
