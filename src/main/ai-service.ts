// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import { normalizeAiModel, normalizeAiProvider } from '../shared/ai-settings.js'
import type { AiProvider, AiTextRequest, AiTextResult, ProsaSettings } from '../shared/types.js'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface AiServiceDeps {
  getSettings: () => ProsaSettings
  getApiKey: (provider: AiProvider) => string | null
  fetchImpl?: FetchLike
}

export interface AiService {
  generateText: (request: AiTextRequest) => Promise<AiTextResult>
}

function normalizeRequest(request: AiTextRequest, settings: ProsaSettings): Required<AiTextRequest> {
  const provider = normalizeAiProvider(request.provider ?? settings.aiProvider)
  const model = normalizeAiModel(request.model ?? settings.aiModel, provider)
  const instruction = request.instruction.trim()
  const input = request.input.trim()
  const maxOutputTokens = request.maxOutputTokens ?? 1200

  if (!instruction) throw new Error('Informe uma instrução para a IA.')
  if (!input) throw new Error('Informe o texto que será enviado para a IA.')
  if (maxOutputTokens < 16) throw new Error('O limite de tokens precisa ser pelo menos 16.')

  return { provider, model, instruction, input, maxOutputTokens }
}

function assertOk(response: Response, body: unknown): void {
  if (response.ok) return
  const message =
    typeof body === 'object' && body !== null && 'error' in body
      ? JSON.stringify((body as { error: unknown }).error)
      : response.statusText
  throw new Error(`Falha no provedor de IA (${response.status}): ${message}`)
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function extractOpenAiText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const record = body as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text.trim()

  const output = Array.isArray(record.output) ? record.output : []
  const parts: string[] = []
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

export function extractGeminiText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const candidates = (body as Record<string, unknown>).candidates
  if (!Array.isArray(candidates)) return ''
  const parts: string[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const content = (candidate as Record<string, unknown>).content
    if (typeof content !== 'object' || content === null) continue
    const contentParts = (content as Record<string, unknown>).parts
    if (!Array.isArray(contentParts)) continue
    for (const part of contentParts) {
      if (typeof part !== 'object' || part === null) continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('\n').trim()
}

async function generateWithOpenAi(request: Required<AiTextRequest>, apiKey: string, fetchImpl: FetchLike): Promise<string> {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: request.model,
      instructions: request.instruction,
      input: request.input,
      max_output_tokens: request.maxOutputTokens
    })
  })
  const body = await readJson(response)
  assertOk(response, body)
  return extractOpenAiText(body)
}

async function generateWithGemini(request: Required<AiTextRequest>, apiKey: string, fetchImpl: FetchLike): Promise<string> {
  const model = request.model.startsWith('models/') ? request.model : `models/${request.model}`
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: request.instruction }]
      },
      contents: [{
        role: 'user',
        parts: [{ text: request.input }]
      }],
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens
      }
    })
  })
  const body = await readJson(response)
  assertOk(response, body)
  return extractGeminiText(body)
}

export function createAiService(deps: AiServiceDeps): AiService {
  const fetchImpl = deps.fetchImpl ?? fetch

  return {
    async generateText(request) {
      const settings = deps.getSettings()
      if (!settings.aiEnabled) {
        throw new Error('A IA ainda não está ativada. Abra as configurações de IA para escolher um provedor, informar a chave e ativar o recurso.')
      }

      const normalized = normalizeRequest(request, settings)
      const apiKey = deps.getApiKey(normalized.provider)
      if (!apiKey) {
        throw new Error(`Falta configurar a chave de API do provedor ${normalized.provider}. Abra as configurações de IA e informe a chave antes de continuar.`)
      }

      const text =
        normalized.provider === 'openai'
          ? await generateWithOpenAi(normalized, apiKey, fetchImpl)
          : await generateWithGemini(normalized, apiKey, fetchImpl)

      if (!text) throw new Error('O provedor de IA não retornou texto.')
      return { provider: normalized.provider, model: normalized.model, text }
    }
  }
}
