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
    { type: 'paragraph', content: [{ type: 'text', text: 'Antes.' }] },
    { type: 'mathBlock', attrs: { latex: 'E = mc^2' } },
    { type: 'paragraph', content: [{ type: 'text', text: 'Depois.' }] }
  ]
}

test('exportMarkdown emite um bloco $$...$$ para mathBlock', () => {
  const md = exportMarkdown(doc)
  assert.match(md, /\$\$\nE = mc\^2\n\$\$/)
})

test('importMarkdown reconhece o bloco $$...$$ como mathBlock via data-latex', () => {
  const md = exportMarkdown(doc)
  const html = importMarkdown(md)
  assert.match(html, /data-math-block/)
  const match = html.match(/data-latex="([^"]+)"/)
  assert.ok(match, 'deveria conter o atributo data-latex')
  assert.equal(decodeURIComponent(match![1]), 'E = mc^2')
})

test('markdown sem blocos $$...$$ não é afetado pelo pré-processamento', () => {
  const plain = '# Título\n\nTexto normal com **negrito**.'
  const html = importMarkdown(plain)
  assert.doesNotMatch(html, /data-math-block/)
  assert.match(html, /<h1>Título<\/h1>/)
})
