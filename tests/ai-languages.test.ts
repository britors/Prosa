// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_TRANSLATION_LANGUAGES } from '../src/shared/ai-languages.ts'

test('idiomas de tradução incluem opções comuns', () => {
  const values = AI_TRANSLATION_LANGUAGES.map((language) => language.value)

  assert.ok(values.includes('português do Brasil'))
  assert.ok(values.includes('inglês'))
  assert.ok(values.includes('espanhol'))
  assert.ok(values.includes('francês'))
})
