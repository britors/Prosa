// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAiService, extractAnthropicText, extractCohereText, extractGeminiText, extractGroqText, extractMistralText, extractOpenAiText } from '../src/main/ai-service.ts'
import type { AiProvider, ProsaSettings } from '../src/shared/types.ts'

function settings(partial: Partial<ProsaSettings> = {}): ProsaSettings {
  return {
    theme: 'dark',
    fontSize: 12,
    fontFamily: 'Georgia',
    lineHeight: 1.6,
    spellcheck: true,
    spellLanguages: ['pt-BR'],
    autoSavePolicy: 'interval',
    autoSaveDebounceSeconds: 30,
    autoSaveIntervalMinutes: 5,
    backupOnSave: true,
    backupKeepVersions: 20,
    pdfPageSize: 'A4',
    pdfLandscape: false,
    pdfPrintBackground: true,
    pdfPreset: 'academic',
    focusWorkMinutes: 25,
    focusBreakMinutes: 5,
    wordGoal: 0,
    fontProfiles: [],
    activeFontProfileId: 'serif',
    showWordCount: true,
    showOutline: true,
    showNotes: false,
    showRelations: false,
    distractionFree: false,
    aiEnabled: true,
    aiProvider: 'openai',
    aiModel: 'gpt-4.1-mini',
    recentFiles: [],
    pinnedFiles: [],
    zoom: 100,
    ...partial
  }
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body
  } as Response
}

test('extrai texto de resposta OpenAI normalizada', () => {
  assert.equal(extractOpenAiText({ output_text: ' resposta ' }), 'resposta')
})

test('extrai texto de resposta Gemini', () => {
  const body = {
    candidates: [{ content: { parts: [{ text: 'parte 1' }, { text: 'parte 2' }] } }]
  }

  assert.equal(extractGeminiText(body), 'parte 1\nparte 2')
})

test('extrai texto de resposta Anthropic', () => {
  const body = {
    content: [{ type: 'text', text: 'linha 1' }, { type: 'text', text: 'linha 2' }]
  }

  assert.equal(extractAnthropicText(body), 'linha 1\nlinha 2')
})

test('extrai texto de resposta Mistral', () => {
  const body = {
    choices: [{ message: { content: 'linha 1\nlinha 2' } }]
  }

  assert.equal(extractMistralText(body), 'linha 1\nlinha 2')
})

test('extrai texto de resposta Groq', () => {
  const body = {
    choices: [{ message: { content: 'linha 1\nlinha 2' } }]
  }

  assert.equal(extractGroqText(body), 'linha 1\nlinha 2')
})

test('extrai texto de resposta Cohere', () => {
  const body = {
    message: { content: [{ type: 'text', text: 'linha 1' }, { type: 'text', text: 'linha 2' }] }
  }

  assert.equal(extractCohereText(body), 'linha 1\nlinha 2')
})

test('serviço chama OpenAI sem expor segredo no payload', async () => {
  const captured: { url: string; init: RequestInit }[] = []
  const service = createAiService({
    getSettings: () => settings(),
    getApiKey: () => 'sk-test',
    fetchImpl: async (url, init) => {
      captured.push({ url, init })
      return jsonResponse({ output_text: 'ok' })
    }
  })

  const result = await service.generateText({ instruction: 'Revise', input: 'Texto' })

  assert.equal(result.text, 'ok')
  assert.equal(captured.length, 1)
  assert.equal(captured[0].url, 'https://api.openai.com/v1/responses')
  assert.equal(JSON.stringify(JSON.parse(String(captured[0].init.body))).includes('sk-test'), false)
})

test('serviço chama Gemini com endpoint do modelo', async () => {
  let capturedUrl = ''
  const service = createAiService({
    getSettings: () => settings({ aiProvider: 'gemini', aiModel: 'gemini-3.5-flash' }),
    getApiKey: (provider: AiProvider) => provider === 'gemini' ? 'gemini-key' : null,
    fetchImpl: async (url) => {
      capturedUrl = url
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'feito' }] } }] })
    }
  })

  const result = await service.generateText({ instruction: 'Resuma', input: 'Texto' })

  assert.equal(result.text, 'feito')
  assert.match(capturedUrl, /models\/gemini-3\.5-flash:generateContent/)
})

test('serviço chama Anthropic com endpoint de messages', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const service = createAiService({
    getSettings: () => settings({ aiProvider: 'anthropic', aiModel: 'claude-fable-5' }),
    getApiKey: (provider: AiProvider) => provider === 'anthropic' ? 'anthropic-key' : null,
    fetchImpl: async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return jsonResponse({ content: [{ type: 'text', text: 'feito' }] })
    }
  })

  const result = await service.generateText({ instruction: 'Resuma', input: 'Texto' })

  assert.equal(result.text, 'feito')
  assert.equal(capturedUrl, 'https://api.anthropic.com/v1/messages')
  const headers = capturedInit?.headers as Record<string, string> | undefined
  assert.equal(headers?.['x-api-key'], 'anthropic-key')
  assert.equal(headers?.['anthropic-version'], '2023-06-01')
  assert.equal(headers?.['content-type'], 'application/json')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.model, 'claude-fable-5')
  assert.equal(body.max_tokens, 1200)
  assert.equal(body.system, 'Resuma')
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Texto' }])
})

test('serviço chama Mistral com endpoint de chat completions', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const service = createAiService({
    getSettings: () => settings({ aiProvider: 'mistral', aiModel: 'mistral-large-latest' }),
    getApiKey: (provider: AiProvider) => provider === 'mistral' ? 'mistral-key' : null,
    fetchImpl: async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return jsonResponse({ choices: [{ message: { content: 'feito' } }] })
    }
  })

  const result = await service.generateText({ instruction: 'Resuma', input: 'Texto' })

  assert.equal(result.text, 'feito')
  assert.equal(capturedUrl, 'https://api.mistral.ai/v1/chat/completions')
  const headers = capturedInit?.headers as Record<string, string> | undefined
  assert.equal(headers?.Authorization, 'Bearer mistral-key')
  assert.equal(headers?.['Content-Type'], 'application/json')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.model, 'mistral-large-latest')
  assert.equal(body.max_tokens, 1200)
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Resuma' },
    { role: 'user', content: 'Texto' }
  ])
})

test('serviço chama Groq com endpoint de chat completions', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const service = createAiService({
    getSettings: () => settings({ aiProvider: 'groq', aiModel: 'llama-3.3-70b-versatile' }),
    getApiKey: (provider: AiProvider) => provider === 'groq' ? 'groq-key' : null,
    fetchImpl: async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return jsonResponse({ choices: [{ message: { content: 'feito' } }] })
    }
  })

  const result = await service.generateText({ instruction: 'Resuma', input: 'Texto' })

  assert.equal(result.text, 'feito')
  assert.equal(capturedUrl, 'https://api.groq.com/openai/v1/chat/completions')
  const headers = capturedInit?.headers as Record<string, string> | undefined
  assert.equal(headers?.Authorization, 'Bearer groq-key')
  assert.equal(headers?.['Content-Type'], 'application/json')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.model, 'llama-3.3-70b-versatile')
  assert.equal(body.max_tokens, 1200)
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Resuma' },
    { role: 'user', content: 'Texto' }
  ])
})

test('serviço chama Cohere com endpoint de chat v2', async () => {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const service = createAiService({
    getSettings: () => settings({ aiProvider: 'cohere', aiModel: 'command-a-03-2025' }),
    getApiKey: (provider: AiProvider) => provider === 'cohere' ? 'cohere-key' : null,
    fetchImpl: async (url, init) => {
      capturedUrl = url
      capturedInit = init
      return jsonResponse({ message: { content: [{ type: 'text', text: 'feito' }] } })
    }
  })

  const result = await service.generateText({ instruction: 'Resuma', input: 'Texto' })

  assert.equal(result.text, 'feito')
  assert.equal(capturedUrl, 'https://api.cohere.com/v2/chat')
  const headers = capturedInit?.headers as Record<string, string> | undefined
  assert.equal(headers?.Authorization, 'Bearer cohere-key')
  assert.equal(headers?.['Content-Type'], 'application/json')
  const body = JSON.parse(String(capturedInit?.body))
  assert.equal(body.model, 'command-a-03-2025')
  assert.equal(body.max_tokens, 1200)
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'Resuma' },
    { role: 'user', content: 'Texto' }
  ])
})

test('serviço bloqueia IA desativada', async () => {
  const service = createAiService({
    getSettings: () => settings({ aiEnabled: false }),
    getApiKey: () => 'sk-test',
    fetchImpl: async () => jsonResponse({ output_text: 'ok' })
  })

  await assert.rejects(
    () => service.generateText({ instruction: 'Revise', input: 'Texto' }),
    /não está ativada/
  )
})
