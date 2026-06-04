// Prosa — Editor de Texto
// Copyright (C) 2026 W3TI SERVIÇOS DE INFORMÁTICA LTDA
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeStats,
  countCharacters,
  countCharactersNoSpaces,
  countWords,
  documentText,
  estimateReadingTime,
  extractOutline
} from '../src/shared/document-utils.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const doc: TipTapJSON = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Capítulo 1' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Era uma vez uma prosa.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Seção 1.1' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Mais texto aqui.' }] },
    { type: 'heading', attrs: { level: 5 }, content: [{ type: 'text', text: 'Profundo' }] }
  ]
}

test('conta palavras corretamente', () => {
  assert.equal(countWords('Era uma vez uma prosa'), 5)
  assert.equal(countWords('   '), 0)
  assert.equal(countWords('palavra'), 1)
})

test('conta caracteres com e sem espaços', () => {
  assert.equal(countCharacters('abc def'), 7)
  assert.equal(countCharactersNoSpaces('abc def'), 6)
})

test('estima o tempo de leitura', () => {
  assert.equal(estimateReadingTime(0), 0)
  assert.equal(estimateReadingTime(100), 1)
  assert.equal(estimateReadingTime(400), 2)
})

test('computeStats agrega todas as contagens', () => {
  const stats = computeStats('Era uma vez uma prosa.')
  assert.equal(stats.words, 5)
  assert.equal(stats.characters, 22)
  assert.equal(stats.readingTimeMinutes, 1)
})

test('extrai o texto completo do documento', () => {
  const text = documentText(doc)
  assert.match(text, /Capítulo 1/)
  assert.match(text, /Era uma vez uma prosa\./)
})

test('extrai a árvore de tópicos (outline) até H4 por padrão', () => {
  const outline = extractOutline(doc)
  // H5 "Profundo" deve ser ignorado por padrão (maxLevel = 4).
  assert.equal(outline.length, 2)
  assert.deepEqual(outline[0], { level: 1, text: 'Capítulo 1', index: 0 })
  assert.deepEqual(outline[1], { level: 2, text: 'Seção 1.1', index: 1 })
})

test('extrai outline incluindo níveis mais profundos quando solicitado', () => {
  const outline = extractOutline(doc, 6)
  assert.equal(outline.length, 3)
  assert.equal(outline[2].text, 'Profundo')
  assert.equal(outline[2].index, 2)
})
