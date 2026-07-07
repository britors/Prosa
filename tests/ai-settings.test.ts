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

test('modelo Claude padrão é aplicado quando o provedor é Anthropic', () => {
  const provider = normalizeAiProvider('anthropic')

  assert.equal(provider, 'anthropic')
  assert.equal(normalizeAiModel('', provider), 'claude-fable-5')
})

test('modelo Mistral padrão é aplicado quando o provedor é Mistral', () => {
  const provider = normalizeAiProvider('mistral')

  assert.equal(provider, 'mistral')
  assert.equal(normalizeAiModel('', provider), 'mistral-large-latest')
})

test('modelo Groq padrão é aplicado quando o provedor é Groq', () => {
  const provider = normalizeAiProvider('groq')

  assert.equal(provider, 'groq')
  assert.equal(normalizeAiModel('', provider), 'llama-3.3-70b-versatile')
})

test('modelo Cohere padrão é aplicado quando o provedor é Cohere', () => {
  const provider = normalizeAiProvider('cohere')

  assert.equal(provider, 'cohere')
  assert.equal(normalizeAiModel('', provider), 'command-a-03-2025')
})

test('listas de modelos vêm preenchidas para OpenAI, Gemini, Anthropic, Mistral, Groq e Cohere', () => {
  assert.deepEqual(AI_MODEL_OPTIONS.openai.map((option) => option.id), [
    'gpt-5.5',
    'gpt-5.4',
    'gpt-5.4-mini',
    'gpt-5.4-nano'
  ])
  assert.ok(AI_MODEL_OPTIONS.gemini.some((option) => option.id === 'gemini-3.5-flash'))
  assert.ok(AI_MODEL_OPTIONS.gemini.some((option) => option.id === 'gemini-2.5-pro'))
  assert.deepEqual(AI_MODEL_OPTIONS.anthropic.map((option) => option.id), [
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-sonnet-5',
    'claude-haiku-4-5'
  ])
  assert.deepEqual(AI_MODEL_OPTIONS.mistral.map((option) => option.id), [
    'mistral-large-latest',
    'mistral-small-latest'
  ])
  assert.deepEqual(AI_MODEL_OPTIONS.groq.map((option) => option.id), [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'gemma2-9b-it'
  ])
  assert.deepEqual(AI_MODEL_OPTIONS.cohere.map((option) => option.id), [
    'command-a-03-2025',
    'command-r-plus-08-2024',
    'command-r-08-2024'
  ])
})
