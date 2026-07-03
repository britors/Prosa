// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFrontmatter, serializeFrontmatter } from '../src/main/frontmatter.ts'

test('markdown sem frontmatter retorna o corpo original intacto', () => {
  const raw = '# Título\n\nTexto normal.'
  const result = parseFrontmatter(raw)
  assert.deepEqual(result.frontmatter, {})
  assert.equal(result.body, raw)
})

test('extrai um bloco de frontmatter simples', () => {
  const raw = '---\ntitle: Meu Post\nauthor: Rodrigo\n---\n\nCorpo do texto.'
  const result = parseFrontmatter(raw)
  assert.deepEqual(result.frontmatter, { title: 'Meu Post', author: 'Rodrigo' })
  assert.equal(result.body, 'Corpo do texto.')
})

test('preserva o valor inteiro após o primeiro dois-pontos (ex: horário)', () => {
  const raw = '---\ntime: 10:30\n---\n\nCorpo.'
  const result = parseFrontmatter(raw)
  assert.equal(result.frontmatter.time, '10:30')
})

test('bloco de frontmatter não fechado é tratado como ausência de frontmatter', () => {
  const raw = '---\ntitle: Sem fechamento\n\nCorpo.'
  const result = parseFrontmatter(raw)
  assert.deepEqual(result.frontmatter, {})
  assert.equal(result.body, raw)
})

test('round-trip parse -> serialize reproduz um bloco equivalente', () => {
  const raw = '---\ntitle: Teste\ntags: [a, b, c]\n---\n\nCorpo.'
  const { frontmatter, body } = parseFrontmatter(raw)
  const rebuilt = serializeFrontmatter(frontmatter) + body
  const reparsed = parseFrontmatter(rebuilt)
  assert.deepEqual(reparsed.frontmatter, frontmatter)
  assert.equal(reparsed.body, body)
})

test('serializeFrontmatter de objeto vazio retorna string vazia', () => {
  assert.equal(serializeFrontmatter({}), '')
  assert.equal(serializeFrontmatter(undefined), '')
})
