// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAiService, extractGeminiText, extractOpenAiText } from '../src/main/ai-service.ts'
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
