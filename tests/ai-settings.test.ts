// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_MODEL_OPTIONS, defaultAiModel, normalizeAiModel, normalizeAiProvider } from '../src/shared/ai-settings.ts'

test('configurações de IA são desligadas por padrão', () => {
  const provider = normalizeAiProvider(undefined)

  assert.equal(provider, 'openai')
  assert.equal(defaultAiModel(provider), 'gpt-5.5')
})

test('configurações de IA inválidas são normalizadas', () => {
  const provider = normalizeAiProvider('invalid-provider')

  assert.equal(provider, 'openai')
  assert.equal(normalizeAiModel('  ', provider), 'gpt-5.5')
})

test('modelo Gemini padrão é aplicado quando o provedor é Gemini', () => {
  const provider = normalizeAiProvider('gemini')

  assert.equal(provider, 'gemini')
  assert.equal(normalizeAiModel('', provider), 'gemini-3.5-flash')
})

test('listas de modelos vêm preenchidas para OpenAI e Gemini', () => {
  assert.deepEqual(AI_MODEL_OPTIONS.openai.map((option) => option.id), [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano'
  ])
  assert.ok(AI_MODEL_OPTIONS.gemini.some((option) => option.id === 'gemini-3.5-flash'))
  assert.ok(AI_MODEL_OPTIONS.gemini.some((option) => option.id === 'gemini-2.5-pro'))
})
