// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectFormat, ensureExtension } from '../src/main/file-formats.ts'

test('detectFormat reconhece cada extensão suportada', () => {
  assert.equal(detectFormat('doc.prosa'), 'prosa')
  assert.equal(detectFormat('doc.docx'), 'docx')
  assert.equal(detectFormat('doc.odt'), 'odt')
  assert.equal(detectFormat('doc.rtf'), 'rtf')
  assert.equal(detectFormat('doc.doc'), 'doc')
  assert.equal(detectFormat('doc.md'), 'md')
  assert.equal(detectFormat('doc.markdown'), 'md')
})

test('detectFormat cai para txt em extensões desconhecidas ou ausentes', () => {
  assert.equal(detectFormat('notas.txt'), 'txt')
  assert.equal(detectFormat('sem-extensao'), 'txt')
  assert.equal(detectFormat('arquivo.csv'), 'txt')
})

test('detectFormat ignora a caixa da extensão', () => {
  assert.equal(detectFormat('Documento.DOCX'), 'docx')
})

test('ensureExtension adiciona a extensão quando ausente', () => {
  assert.equal(ensureExtension('/tmp/relatorio', 'docx'), '/tmp/relatorio.docx')
})

test('ensureExtension não duplica quando a extensão já está presente', () => {
  assert.equal(ensureExtension('/tmp/relatorio.docx', 'docx'), '/tmp/relatorio.docx')
})

test('ensureExtension é case-insensitive ao checar a extensão existente', () => {
  assert.equal(ensureExtension('/tmp/relatorio.DOCX', 'docx'), '/tmp/relatorio.DOCX')
})
