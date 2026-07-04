// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { documentVariableToken, resolveDocumentVariables, resolveDocumentVariablesInTipTap } from '../src/shared/document-variables.ts'
import type { TipTapJSON } from '../src/shared/types.ts'

const context = {
  metadata: {
    title: 'Relatório',
    author: 'Rodrigo',
    createdAt: '2026-07-01T10:00:00.000Z',
    modifiedAt: '2026-07-02T10:00:00.000Z'
  },
  currentPath: '/tmp/relatorio.prosa'
}

test('documentVariableToken gera o marcador esperado', () => {
  assert.equal(documentVariableToken('title'), '{{title}}')
})

test('resolveDocumentVariables substitui metadados e caminho', () => {
  const value = resolveDocumentVariables('Título: {{title}} | Autor: {{author}} | Arquivo: {{path}} | Data: {{date}}', context)
  assert.match(value, /Relatório/)
  assert.match(value, /Rodrigo/)
  assert.match(value, /relatorio\.prosa/)
})

test('resolveDocumentVariables preserva tokens de paginação quando solicitado', () => {
  const value = resolveDocumentVariables('Página {{page}} de {{total}}', context, { preservePaginationTokens: true })
  assert.equal(value, 'Página {page} de {total}')
})

test('resolveDocumentVariablesInTipTap substitui texto em nós TipTap', () => {
  const doc: TipTapJSON = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Olá {{title}}' }] }]
  }
  const resolved = resolveDocumentVariablesInTipTap(doc, context)
  assert.equal(resolved.content?.[0].content?.[0].text, 'Olá Relatório')
})
