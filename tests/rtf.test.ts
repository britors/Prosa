// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportRtf, importRtf } from '../src/main/rtf.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const doc: TipTapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título RTF' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Um ' },
        { type: 'text', text: 'negrito', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' e um ' },
        { type: 'text', text: 'itálico', marks: [{ type: 'italic' }] },
        { type: 'text', text: '.' }
      ]
    }
  ]
}

test('exporta um cabeçalho .rtf válido', () => {
  const rtf = exportRtf(doc)
  assert.match(rtf, /^\{\\rtf1\\ansi/)
  assert.ok(rtf.endsWith('}'))
})

test('exporta negrito e itálico em RTF', () => {
  const rtf = exportRtf(doc)
  assert.match(rtf, /\\b /)
  assert.match(rtf, /\\i /)
})

test('importa RTF simples para HTML', () => {
  const html = importRtf('{\\rtf1\\ansi Olá \\b mundo\\b0 .\\par}')
  assert.match(html, /<strong>mundo<\/strong>/)
  assert.match(html, /Olá/)
})

test('round-trip RTF preserva negrito e itálico', () => {
  const rtf = exportRtf(doc)
  const html = importRtf(rtf)
  assert.match(html, /<strong>negrito<\/strong>/)
  assert.match(html, /<em>itálico<\/em>/)
})

test('importa caracteres Unicode (\\u) do RTF', () => {
  // \u231? representa "ç" (U+00E7 = 231) com caractere de fallback.
  const html = importRtf('{\\rtf1\\ansi a\\u231?o\\par}')
  assert.match(html, /aço/)
})

test('ignora destinos como fonttbl ao importar RTF', () => {
  const html = importRtf(
    '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}Conteúdo real\\par}'
  )
  assert.match(html, /Conteúdo real/)
  assert.doesNotMatch(html, /Arial/)
})
