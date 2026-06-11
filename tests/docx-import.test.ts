// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { importDocx, exportDocx } from '../src/main/converters.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

/** Documento de exemplo com título, formatação e tabela. */
const sample: TipTapJSON = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Relatório Anual' }]
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Texto ', marks: [] },
        { type: 'text', text: 'em negrito', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' e ' },
        { type: 'text', text: 'em itálico', marks: [{ type: 'italic' }] },
        { type: 'text', text: '.' }
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
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mês' }] }]
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Valor' }] }]
            }
          ]
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Janeiro' }] }]
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '1000' }] }]
            }
          ]
        }
      ]
    }
  ]
}

test('importa .docx preservando o título (heading)', async () => {
  const buffer = await exportDocx(sample)
  const html = await importDocx(buffer)
  assert.match(html, /<h1>Relatório Anual<\/h1>/)
})

test('importa .docx preservando negrito e itálico', async () => {
  const buffer = await exportDocx(sample)
  const html = await importDocx(buffer)
  assert.match(html, /<strong>em negrito<\/strong>/)
  assert.match(html, /<em>em itálico<\/em>/)
})

test('importa .docx preservando a tabela', async () => {
  const buffer = await exportDocx(sample)
  const html = await importDocx(buffer)
  assert.match(html, /<table>/)
  assert.match(html, /Janeiro/)
  assert.match(html, /1000/)
})
