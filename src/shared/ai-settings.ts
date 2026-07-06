// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AiProvider } from './types.js'

const VALID_AI_PROVIDERS: readonly AiProvider[] = ['openai', 'gemini']

export interface AiModelOption {
  id: string
  label: string
}

export const AI_MODEL_OPTIONS: Record<AiProvider, readonly AiModelOption[]> = {
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' }
  ],
  gemini: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
    { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
  ]
}

export function normalizeAiProvider(value: unknown): AiProvider {
  if (typeof value === 'string' && VALID_AI_PROVIDERS.includes(value as AiProvider)) return value as AiProvider
  return 'openai'
}

export function defaultAiModel(provider: AiProvider): string {
  return AI_MODEL_OPTIONS[provider][0].id
}

export function normalizeAiModel(value: unknown, provider: AiProvider): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return defaultAiModel(provider)
}
