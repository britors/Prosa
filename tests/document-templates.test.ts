// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DOCUMENT_TEMPLATES, getDocumentTemplate } from '../src/shared/document-templates.ts'

test('biblioteca inicial de modelos contém os documentos principais', () => {
  assert.equal(DOCUMENT_TEMPLATES.length, 6)
  assert.ok(getDocumentTemplate('artigo'))
  assert.ok(getDocumentTemplate('relatorio'))
  assert.ok(getDocumentTemplate('contrato'))
  assert.ok(getDocumentTemplate('ata'))
  assert.ok(getDocumentTemplate('proposta-comercial'))
  assert.ok(getDocumentTemplate('capitulo'))
})
