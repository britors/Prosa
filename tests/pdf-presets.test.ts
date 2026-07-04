// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePdfPrintOptions } from '../src/main/export-service.ts'

test('preset acadêmico usa A4 e fundo impresso', () => {
  const options = resolvePdfPrintOptions('academic')
  assert.equal(options.pageSize, 'A4')
  assert.equal(options.landscape, false)
  assert.equal(options.printBackground, true)
})

test('preset contrato usa Legal e margens compactas', () => {
  const options = resolvePdfPrintOptions('contract')
  assert.equal(options.pageSize, 'Legal')
  assert.equal(options.printBackground, false)
  assert.ok(options.margins.left < 1)
  assert.ok(options.margins.top < 1)
})
