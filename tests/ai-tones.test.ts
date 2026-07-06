// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_TONE_OPTIONS } from '../src/shared/ai-tones.ts'

test('tons de IA incluem opções comuns de escrita', () => {
  const values = AI_TONE_OPTIONS.map((tone) => tone.value)

  assert.ok(values.includes('formal'))
  assert.ok(values.includes('profissional'))
  assert.ok(values.includes('acadêmico'))
  assert.ok(values.includes('claro e simples'))
})
