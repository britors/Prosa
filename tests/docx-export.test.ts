// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportDocx, importDocx } from '../src/main/converters.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const doc: TipTapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Subtítulo' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Parágrafo simples.' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item um' }] }]
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item dois' }] }]
        }
      ]
    }
  ]
}

test('exporta TipTap JSON para um buffer .docx válido (assinatura ZIP)', async () => {
  const buffer = await exportDocx(doc)
  assert.ok(buffer.length > 0)
  // Arquivos .docx são ZIPs: começam com a assinatura "PK".
  assert.equal(buffer[0], 0x50)
  assert.equal(buffer[1], 0x4b)
})

test('o .docx exportado preserva o conteúdo ao reimportar', async () => {
  const buffer = await exportDocx(doc)
  const html = await importDocx(buffer)
  assert.match(html, /Subtítulo/)
  assert.match(html, /Parágrafo simples\./)
  assert.match(html, /Item um/)
  assert.match(html, /Item dois/)
})

test('exporta documento vazio sem lançar erro', async () => {
  const empty: TipTapJSON = { type: 'doc', content: [] }
  const buffer = await exportDocx(empty)
  assert.ok(buffer.length > 0)
})
