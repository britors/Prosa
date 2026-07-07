// Prosa — Editor de Texto
// Copyright (C) 2026 Rodrigo Brito
// SPDX-License-Identifier: GPL-3.0-or-later

import type { AiProvider } from './types.js'

const VALID_AI_PROVIDERS: readonly AiProvider[] = ['openai', 'gemini', 'anthropic', 'mistral', 'groq', 'cohere']

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
  ],
  anthropic: [
    { id: 'claude-fable-5', label: 'Claude Fable 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large' },
    { id: 'mistral-small-latest', label: 'Mistral Small' }
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
    { id: 'gemma2-9b-it', label: 'Gemma 2 9B IT' }
  ],
  cohere: [
    { id: 'command-a-03-2025', label: 'Command A' },
    { id: 'command-r-plus-08-2024', label: 'Command R+' },
    { id: 'command-r-08-2024', label: 'Command R' }
  ]
}

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && VALID_AI_PROVIDERS.includes(value as AiProvider)
}

export function normalizeAiProvider(value: unknown): AiProvider {
  if (isAiProvider(value)) return value
  return 'openai'
}

export function defaultAiModel(provider: AiProvider): string {
  return AI_MODEL_OPTIONS[provider][0].id
}

export function normalizeAiModel(value: unknown, provider: AiProvider): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return defaultAiModel(provider)
}
